import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import "cesium/Build/Cesium/Widgets/widgets.css";
import { Leaf, Plus, Map as MapIcon, Info, List, Search, X, ChevronRight, Pencil, ShieldCheck, AlertCircle } from 'lucide-react';
import { PlantMarker } from '../types';
import { PlantPopup } from './PlantPopup';
import { motion, AnimatePresence } from 'motion/react';
import { 
  auth, 
  db, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  OperationType,
  handleFirestoreError,
  signInAnonymously
} from '../firebase';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const CESIUM_ION_ACCESS_TOKEN = import.meta.env.VITE_CESIUM_ION_ACCESS_TOKEN;

// Parliament of Victoria, Melbourne - Centered more on the Annexe/Gardens
const INITIAL_CENTER = {
  lng: 144.9742,
  lat: -37.8108
};

interface MapComponentProps {
  markers: PlantMarker[];
  onMarkerClick: (marker: PlantMarker) => void;
  selectedMarker: PlantMarker | null;
  onClosePopup: () => void;
  onUpdatePosition: (updated: PlantMarker) => void;
  deleteMarker: (id: string) => void;
  viewerRef: React.MutableRefObject<Cesium.Viewer | null>;
  canEdit?: boolean;
}

const MarkerOverlay: React.FC<{
  viewer: Cesium.Viewer;
  markers: PlantMarker[];
  onMarkerClick: (marker: PlantMarker) => void;
  onDragStart: (e: React.MouseEvent, marker: PlantMarker) => void;
  canEdit?: boolean;
}> = ({ viewer, markers, onMarkerClick, onDragStart, canEdit = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const markerRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const update = () => {
      if (!containerRef.current || !viewer || viewer.isDestroyed()) return;
      const floatingHeight = 20;

      markers.forEach(marker => {
        const el = markerRefs.current[marker.id];
        if (!el) return;

        // 1. Get ground position (terrain aware)
        let groundPos = Cesium.Cartesian3.fromDegrees(marker.longitude, marker.latitude, 0);
        // Try to clamp to terrain/tiles for accurate ground contact
        const clamped = viewer.scene.clampToHeight(groundPos);
        if (Cesium.defined(clamped)) {
          groundPos = clamped;
        }

        // 2. Get floating position (20m above ground, following surface normal)
        const up = viewer.scene.globe.ellipsoid.geodeticSurfaceNormal(groundPos);
        const floatingPos = Cesium.Cartesian3.add(
          groundPos,
          Cesium.Cartesian3.multiplyByScalar(up, floatingHeight, new Cesium.Cartesian3()),
          new Cesium.Cartesian3()
        );

        const screenPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, floatingPos);
        const screenGroundPos = Cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, groundPos);

        // Simple visibility check: is the point in front of the camera?
        const cameraPosition = viewer.camera.position;
        const cameraDirection = viewer.camera.direction;
        const toPoint = Cesium.Cartesian3.subtract(floatingPos, cameraPosition, new Cesium.Cartesian3());
        const isVisible = Cesium.Cartesian3.dot(cameraDirection, toPoint) > 0;

        if (screenPos && screenGroundPos && isVisible) {
          el.style.display = 'block';
          el.style.transform = `translate3d(${screenPos.x}px, ${screenPos.y}px, 0) translate(-50%, -50%)`;
          
          // Update tether line
          const line = el.querySelector('.tether-line') as HTMLDivElement;
          if (line) {
            const dx = screenGroundPos.x - screenPos.x;
            const dy = screenGroundPos.y - screenPos.y;
            const length = Math.sqrt(dx*dx + dy*dy);
            const angle = Math.atan2(dy, dx);
            line.style.height = `${length}px`;
            line.style.transform = `rotate(${angle - Math.PI/2}rad)`;
          }

          // Update ground anchor dot
          const groundAnchor = el.querySelector('.ground-anchor') as HTMLDivElement;
          if (groundAnchor) {
            const dx = screenGroundPos.x - screenPos.x;
            const dy = screenGroundPos.y - screenPos.y;
            groundAnchor.style.transform = `translate(${dx}px, ${dy}px) translate(-50%, -50%)`;
          }
        } else {
          el.style.display = 'none';
        }
      });
    };

    const remove = viewer.scene.postRender.addEventListener(update);
    // Trigger an initial update after the component has rendered its markers
    requestAnimationFrame(update);
    return () => remove();
  }, [viewer, markers]);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {markers.map(marker => (
        <div
          key={marker.id}
          ref={el => { markerRefs.current[marker.id] = el; }}
          className="absolute left-0 top-0"
        >
           {/* The plant icon - clickable for details */}
           <div 
             className="w-10 h-10 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg border-2 border-white/40 relative z-10 overflow-hidden pointer-events-auto cursor-pointer"
             onClick={(e) => {
               e.stopPropagation();
               onMarkerClick(marker);
             }}
           >
              {marker.imageUrl ? (
                <img 
                  src={marker.imageUrl} 
                  alt="" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <Leaf size={20} className="text-white" />
              )}
           </div>
           {/* The tether line connecting icon to ground */}
           <div className="tether-line absolute top-1/2 left-1/2 w-0.5 bg-white/40 origin-top pointer-events-none" />
           {/* The ground anchor point - handles dragging only in edit mode */}
           <div 
             className={`ground-anchor absolute top-1/2 left-1/2 w-2 h-2 bg-emerald-500/60 rounded-full border border-white/40 pointer-events-auto ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
             onClick={(e) => {
               e.stopPropagation();
               onMarkerClick(marker);
             }}
             onMouseDown={(e) => {
               if (e.button === 0 && canEdit) { // Left click only and in edit mode
                 onDragStart(e, marker);
               }
             }}
           />
        </div>
      ))}
    </div>
  );
};

const MapComponent: React.FC<MapComponentProps> = ({ 
  markers, 
  onMarkerClick, 
  selectedMarker, 
  onClosePopup,
  onUpdatePosition,
  deleteMarker,
  viewerRef,
  canEdit = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const draggingMarkerIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const draggedRef = useRef(false);
  const dragStartPosRef = useRef<Cesium.Cartesian2 | null>(null);
  const hasInitialZoomedRef = useRef(false);

  // Use refs for callbacks and markers to avoid re-initializing the viewer unnecessarily
  const onMarkerClickRef = useRef(onMarkerClick);
  const onUpdatePositionRef = useRef(onUpdatePosition);
  const markersRef = useRef(markers);

  useEffect(() => {
    onMarkerClickRef.current = onMarkerClick;
    onUpdatePositionRef.current = onUpdatePosition;
    markersRef.current = markers;
  }, [onMarkerClick, onUpdatePosition, markers]);

  const zoomToMarkers = useCallback((markersToFit: PlantMarker[]) => {
    if (!viewerRef.current || markersToFit.length === 0) return;
    
    const viewer = viewerRef.current;
    
    const lons = markersToFit.map(m => m.longitude);
    const lats = markersToFit.map(m => m.latitude);
    
    const west = Math.min(...lons);
    const east = Math.max(...lons);
    const south = Math.min(...lats);
    const north = Math.max(...lats);
    
    const centerLon = (west + east) / 2;
    const centerLat = (south + north) / 2;
    
    const lonSpan = east - west;
    const latSpan = north - south;
    const maxSpan = Math.max(lonSpan, latSpan, 0.001);
    
    // Create a bounding sphere around the markers
    const centerCartesian = Cesium.Cartesian3.fromDegrees(centerLon, centerLat);
    // Radius heuristic: convert degrees to meters roughly (1 deg ~ 111km)
    const radius = Math.max(maxSpan * 60000, 100); 
    const boundingSphere = new Cesium.BoundingSphere(centerCartesian, radius);

    // 1. Teleport to high top-down view of the markers
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, radius * 10),
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90),
        roll: 0
      }
    });

    // 2. Animate to lower tilted view to showcase movement
    viewer.camera.flyToBoundingSphere(boundingSphere, {
      offset: new Cesium.HeadingPitchRange(
        Cesium.Math.toRadians(0),
        Cesium.Math.toRadians(-35), // Tilted view
        radius * 3.5 // Range (distance from center)
      ),
      duration: 4.0,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT
    });
  }, [viewerRef]);

  useEffect(() => {
    if (isMapLoaded && markers.length > 0 && !hasInitialZoomedRef.current) {
      zoomToMarkers(markers);
      hasInitialZoomedRef.current = true;
    }
  }, [isMapLoaded, markers, zoomToMarkers]);

  // Global mouseup listener to ensure drag state is cleared even if released outside canvas
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        draggingMarkerIdRef.current = null;
        if (viewerRef.current && !viewerRef.current.isDestroyed()) {
          viewerRef.current.scene.screenSpaceCameraController.enableInputs = true;
        }
      }
    };

    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    let viewer: Cesium.Viewer | null = null;
    let removeCameraListener: (() => void) | null = null;

    const initCesium = async () => {
      try {
        if (CESIUM_ION_ACCESS_TOKEN) {
          Cesium.Ion.defaultAccessToken = CESIUM_ION_ACCESS_TOKEN;
        }

        viewer = new Cesium.Viewer(containerRef.current!, {
          terrain: Cesium.Terrain.fromWorldTerrain(),
          baseLayer: false, // Disable default 2D map underlay
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          vrButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
          scene3DOnly: true,
        });

        viewerRef.current = viewer;

        // Add Google Maps 2D satellite images from Cesium Ion (Asset ID 3830182)
        try {
          const layer = viewer.imageryLayers.addImageryProvider(
            await Cesium.IonImageryProvider.fromAssetId(3830182),
          );
        } catch (error) {
          console.error("Error loading Google Maps 2D satellite imagery from Ion:", error);
        }

        if (viewer.isDestroyed()) return;

        // --- Camera Constraints ---
        const controller = viewer.scene.screenSpaceCameraController;
        controller.minimumZoomDistance = 50;   // Don't get too close to ground
        controller.maximumZoomDistance = 800;  // Don't zoom out too far

        // Define a tighter bounding box around Parliament (approx 250m radius)
        const minLon = 144.970;
        const maxLon = 144.976;
        const minLat = -37.814;
        const maxLat = -37.808;

        removeCameraListener = viewer.camera.changed.addEventListener(() => {
          if (!viewer || viewer.isDestroyed()) return;
          
          const camera = viewer.camera;
          const cartographic = Cesium.Cartographic.fromCartesian(camera.position);
          if (!cartographic) return;

          const lon = Cesium.Math.toDegrees(cartographic.longitude);
          const lat = Cesium.Math.toDegrees(cartographic.latitude);

          let correctedLon = lon;
          let correctedLat = lat;
          let needsCorrection = false;

          // Add a small buffer to prevent jitter
          const buffer = 0.0001;

          if (lon < minLon) { correctedLon = minLon + buffer; needsCorrection = true; }
          if (lon > maxLon) { correctedLon = maxLon - buffer; needsCorrection = true; }
          if (lat < minLat) { correctedLat = minLat + buffer; needsCorrection = true; }
          if (lat > maxLat) { correctedLat = maxLat - buffer; needsCorrection = true; }

          if (needsCorrection) {
            camera.setView({
              destination: Cesium.Cartesian3.fromDegrees(correctedLon, correctedLat, cartographic.height),
              orientation: {
                heading: camera.heading,
                pitch: camera.pitch,
                roll: camera.roll
              }
            });
          }
        });
        // ---------------------------

        // Set initial view to a high top-down perspective
        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(INITIAL_CENTER.lng, INITIAL_CENTER.lat, 2000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0.0
          }
        });

        // Drag and Drop Logic
        const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
        
        // MOUSE_MOVE: Update position if dragging
        handler.setInputAction((movement: any) => {
          if (!viewer || viewer.isDestroyed()) return;
          if (isDraggingRef.current && draggingMarkerIdRef.current) {
            // Only consider it a drag if moved more than 5 pixels
            if (!draggedRef.current && dragStartPosRef.current) {
              const dist = Cesium.Cartesian2.distance(dragStartPosRef.current, movement.endPosition);
              if (dist > 5) {
                draggedRef.current = true;
              }
            }

            // Only update position if we have confirmed this is a drag
            if (draggedRef.current) {
              const ray = viewer.camera.getPickRay(movement.endPosition);
              const cartesian = viewer.scene.globe.pick(ray!, viewer.scene);
              if (Cesium.defined(cartesian)) {
                const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
                const lng = Cesium.Math.toDegrees(cartographic.longitude);
                const lat = Cesium.Math.toDegrees(cartographic.latitude);
                
                // Update marker in state
                const marker = markersRef.current.find(m => m.id === draggingMarkerIdRef.current);
                if (marker) {
                  onUpdatePositionRef.current({
                    ...marker,
                    latitude: lat,
                    longitude: lng
                  });
                }
              }
            }
          }
        }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

        // LEFT_UP: End dragging
        handler.setInputAction(() => {
          if (!viewer || viewer.isDestroyed()) return;
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            draggingMarkerIdRef.current = null;
            viewer.scene.screenSpaceCameraController.enableInputs = true;
          }
        }, Cesium.ScreenSpaceEventType.LEFT_UP);

        // LEFT_CLICK: Close popup when clicking the map
        handler.setInputAction(() => {
          if (!viewer || viewer.isDestroyed()) return;
          onClosePopup();
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

        // Track tile loading progress to hide loading screen
        let initialLoadComplete = false;
        const removeTileLoadListener = viewer.scene.globe.tileLoadProgressEvent.addEventListener((queueLength) => {
          if (queueLength === 0 && !initialLoadComplete) {
            initialLoadComplete = true;
            setIsMapLoaded(true);
            removeTileLoadListener();
          }
        });

        setViewerReady(true);
      } catch (error) {
        console.error("Error initializing Cesium:", error);
      }
    };

    initCesium();

    return () => {
      if (viewer && !viewer.isDestroyed()) {
        if (removeCameraListener) removeCameraListener();
        viewer.destroy();
        viewerRef.current = null;
      }
    };
  }, [viewerRef]);

  const onDragStart = (e: React.MouseEvent, marker: PlantMarker) => {
    e.stopPropagation();
    if (!viewerRef.current || selectedMarker || !canEdit) return;
    draggingMarkerIdRef.current = marker.id;
    isDraggingRef.current = true;
    draggedRef.current = false;
    
    // Convert client coordinates to canvas coordinates for distance calculation
    const rect = viewerRef.current.canvas.getBoundingClientRect();
    dragStartPosRef.current = new Cesium.Cartesian2(
      e.clientX - rect.left,
      e.clientY - rect.top
    );

    viewerRef.current.scene.screenSpaceCameraController.enableInputs = false;
  };

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full bg-gray-900" />
      
      <AnimatePresence>
        {!isMapLoaded && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gray-900"
          >
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="w-16 h-16 border-t-2 border-emerald-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Leaf size={24} className="text-emerald-500 animate-pulse" />
                </div>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-white/60 font-medium tracking-widest uppercase text-xs">Loading Map</span>
                <div className="flex gap-1">
                  <span className="w-1 h-1 bg-emerald-500 rounded-full animate-dot-1" />
                  <span className="w-1 h-1 bg-emerald-500 rounded-full animate-dot-2" />
                  <span className="w-1 h-1 bg-emerald-500 rounded-full animate-dot-3" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {viewerReady && viewerRef.current && (
        <MarkerOverlay
          viewer={viewerRef.current}
          markers={markers}
          onMarkerClick={(marker) => {
            if (!draggedRef.current) {
              onMarkerClick(marker);
            }
          }}
          onDragStart={onDragStart}
          canEdit={canEdit}
        />
      )}
    </div>
  );
};

export const GardenMap: React.FC = () => {
  const [markers, setMarkers] = useState<PlantMarker[]>([]);
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem('garden_unlocked') === 'true';
  });
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  const [selectedMarker, setSelectedMarker] = useState<PlantMarker | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);

  // Handle Anonymous Auth for Firestore Rules
  useEffect(() => {
    signInAnonymously(auth).catch(err => {
      if (err.code === 'auth/admin-restricted-operation') {
        const msg = "Anonymous Authentication is disabled in your Firebase project. Please enable it in the Firebase Console (Authentication > Sign-in method > Anonymous).";
        console.error(msg);
        setAuthError(msg);
      } else {
        console.error("Anonymous Auth Error:", err);
        setAuthError(err.message);
      }
    });
  }, []);

  // Sync with Firestore - ALL MARKERS (Shared Data Set)
  useEffect(() => {
    const q = query(collection(db, 'markers'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMarkers = snapshot.docs.map(doc => doc.data() as PlantMarker);
      setMarkers(newMarkers);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'markers');
    });

    return () => unsubscribe();
  }, []);

  const handleUnlockEditing = () => {
    setIsUnlocked(true);
    sessionStorage.setItem('garden_unlocked', 'true');
    setShowUnlockConfirm(false);
  };

  const handleLockEditing = () => {
    setIsUnlocked(false);
    sessionStorage.removeItem('garden_unlocked');
  };

  const canEdit = isUnlocked;

  const onMapClick = useCallback(async (lngLat: { lat: number; lng: number }) => {
    if (!canEdit) return null;

    const newMarker: PlantMarker = {
      id: Math.random().toString(36).substr(2, 9),
      uid: auth.currentUser?.uid || 'anonymous',
      latitude: lngLat.lat,
      longitude: lngLat.lng,
      name: 'New Plant',
      description: '',
      imageUrl: `https://picsum.photos/seed/${Math.random()}/400/300`,
      createdAt: Date.now()
    };

    try {
      await setDoc(doc(db, 'markers', newMarker.id), newMarker);
      return newMarker;
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `markers/${newMarker.id}`);
      return null;
    }
  }, [canEdit]);

  const addMarkerAtCenter = async () => {
    if (!viewerRef.current || !canEdit) return;
    const viewer = viewerRef.current;
    const center = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
    
    let cartesian;
    if (viewer.scene.pickPositionSupported) {
      cartesian = viewer.scene.pickPosition(center);
    }
    
    if (!Cesium.defined(cartesian)) {
      const ray = viewer.camera.getPickRay(center);
      cartesian = viewer.scene.globe.pick(ray!, viewer.scene);
    }

    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const marker = await onMapClick({
        lat: Cesium.Math.toDegrees(cartographic.latitude),
        lng: Cesium.Math.toDegrees(cartographic.longitude)
      });
      
      if (marker) {
        setSelectedMarker(marker);
      }
    }
  };

  const updateMarker = async (updated: PlantMarker) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'markers', updated.id), updated, { merge: true });
      setSelectedMarker(updated);
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `markers/${updated.id}`);
    }
  };

  const updatePosition = async (updated: PlantMarker) => {
    if (!canEdit) return;
    try {
      await setDoc(doc(db, 'markers', updated.id), updated, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `markers/${updated.id}`);
    }
  };

  const deleteMarker = async (id: string) => {
    if (!canEdit) return;
    try {
      await deleteDoc(doc(db, 'markers', id));
      setSelectedMarker(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `markers/${id}`);
    }
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <MapComponent 
        markers={markers}
        onMarkerClick={setSelectedMarker}
        selectedMarker={selectedMarker}
        onClosePopup={() => setSelectedMarker(null)}
        onUpdatePosition={updatePosition}
        deleteMarker={deleteMarker}
        viewerRef={viewerRef}
        canEdit={canEdit}
      />

      {/* Controls */}
      <div className="absolute top-0 left-0 z-10 flex flex-col gap-4 p-0">
        {authError && (
          <div className="m-2 p-2 bg-red-500/20 backdrop-blur-md border border-red-500/30 rounded-lg text-red-200 text-[10px] max-w-[150px] flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}
        {!isUnlocked ? (
          <button 
            onClick={() => setShowUnlockConfirm(true)}
            className="w-6 h-6 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white/10 hover:text-white/40 transition-all active:scale-95 group"
            title="Unlock Editing"
          >
            <Pencil size={12} className="group-hover:scale-110 transition-transform" />
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <button 
              onClick={addMarkerAtCenter}
              className="w-10 h-10 bg-emerald-500 hover:bg-emerald-600 backdrop-blur-md border border-emerald-500/30 rounded-full flex items-center justify-center text-white transition-all active:scale-95 shadow-xl"
              title="Add Plant"
            >
              <Plus size={20} strokeWidth={1.5} />
            </button>
            <button 
              onClick={handleLockEditing}
              className="w-10 h-10 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-all active:scale-95 shadow-lg"
              title="Lock Editing"
            >
              <ShieldCheck size={18} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      {/* Unlock Confirmation Popup */}
      <AnimatePresence>
        {showUnlockConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900/90 border border-white/10 p-8 rounded-[32px] shadow-2xl max-w-sm w-full text-center"
            >
              <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <Pencil className="text-emerald-500" size={32} />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">Enter Edit Mode?</h2>
              <p className="text-gray-400 mb-8 text-sm leading-relaxed">
                You will be able to add new plants and move existing ones around the garden.
              </p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleUnlockEditing}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-medium transition-colors"
                >
                  Yes, start editing
                </button>
                <button 
                  onClick={() => setShowUnlockConfirm(false)}
                  className="w-full py-4 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-2xl font-medium transition-colors"
                >
                  Maybe later
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Popup Overlay - Minimalist */}
      <AnimatePresence>
        {selectedMarker && (
          <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center p-4">
            <div className="pointer-events-auto">
              <PlantPopup
                marker={selectedMarker}
                onSave={updateMarker}
                onDelete={deleteMarker}
                onClose={() => setSelectedMarker(null)}
                canEdit={canEdit}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
