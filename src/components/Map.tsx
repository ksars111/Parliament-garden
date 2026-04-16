import React, { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Leaf, Plus, Map as MapIcon, Info, X, ChevronRight, Pencil, ShieldCheck, AlertCircle, Layers, Home } from 'lucide-react';
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

// Parliament of Victoria, Melbourne
const INITIAL_CENTER: [number, number] = [144.9742, -37.8108];
const INITIAL_ZOOM = 17;

// 1 square km boundary around the center
const BOUNDS_OFFSET_LAT = 0.0045; // ~500m
const BOUNDS_OFFSET_LNG = 0.0057; // ~500m at this latitude
const MAX_BOUNDS: maplibregl.LngLatBoundsLike = [
  [INITIAL_CENTER[0] - BOUNDS_OFFSET_LNG, INITIAL_CENTER[1] - BOUNDS_OFFSET_LAT], // SW
  [INITIAL_CENTER[0] + BOUNDS_OFFSET_LNG, INITIAL_CENTER[1] + BOUNDS_OFFSET_LAT]  // NE
];

interface MapComponentProps {
  markers: PlantMarker[];
  onMarkerClick: (marker: PlantMarker) => void;
  selectedMarker: PlantMarker | null;
  onClosePopup: () => void;
  onUpdatePosition: (updated: PlantMarker) => void;
  deleteMarker: (id: string) => void;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  canEdit?: boolean;
  onAnimationComplete?: () => void;
  isDataLoading?: boolean;
}

const MapComponent: React.FC<MapComponentProps> = ({ 
  markers, 
  onMarkerClick, 
  selectedMarker, 
  onClosePopup,
  onUpdatePosition,
  deleteMarker,
  mapRef,
  canEdit = false,
  onAnimationComplete,
  isDataLoading = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [showLabels, setShowLabels] = useState(INITIAL_ZOOM > 20.5);
  const [displayZoom, setDisplayZoom] = useState(INITIAL_ZOOM);
  const [isAngled, setIsAngled] = useState(true);
  const markersLayerRef = useRef<Record<string, maplibregl.Marker>>({});
  const rafRef = useRef<number | null>(null);
  const hasInitialFit = useRef(false);

  const updateMarkerZIndices = useCallback(() => {
    if (!mapRef.current) return;
    
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    
    rafRef.current = requestAnimationFrame(() => {
      const map = mapRef.current;
      if (!map) return;
      
      const bounds = map.getBounds();
      
      Object.values(markersLayerRef.current).forEach((marker) => {
        const lngLat = marker.getLngLat();
        
        // Culling: Only update markers in or near viewport
        if (!bounds.contains(lngLat)) {
          marker.getElement().style.display = 'none';
          return;
        }
        
        marker.getElement().style.display = 'block';
        const point = map.project(lngLat);
        // Higher Y (bottom of screen) = closer to camera = higher z-index
        marker.getElement().style.zIndex = Math.round(point.y).toString();
      });
    });
  }, [mapRef]);

  // Initialize Map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          'google-satellite': {
            type: 'raster',
            tiles: ['https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'],
            tileSize: 256,
            attribution: '© Google'
          }
        },
        layers: [
          {
            id: 'google-satellite',
            type: 'raster',
            source: 'google-satellite',
            minzoom: 0,
            maxzoom: 24
          }
        ]
      },
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      maxZoom: 24,
      maxBounds: MAX_BOUNDS,
      pitch: 45, // Slight tilt like Felt
    });

    mapRef.current = map;

    map.on('load', () => {
      setIsMapLoaded(true);
      const zoom = map.getZoom();
      setShowLabels(zoom > 20.5);
      setDisplayZoom(zoom);
      updateMarkerZIndices();
    });

    map.on('zoom', () => {
      const zoom = map.getZoom();
      
      // Update labels state only on threshold crossing
      setShowLabels(prev => {
        const next = zoom > 20.5;
        return prev === next ? prev : next;
      });

      // Update display zoom for UI (throttled implicitly by React state batching)
      setDisplayZoom(zoom);
    });

    map.on('move', updateMarkerZIndices);
    map.on('rotate', updateMarkerZIndices);
    map.on('pitch', (e) => {
      setIsAngled(map.getPitch() > 0);
      updateMarkerZIndices();
    });

    map.on('click', (e) => {
      // Close popup when clicking the map
      if (!e.defaultPrevented) {
        onClosePopup();
      }
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync Markers
  useEffect(() => {
    if (!isMapLoaded || !mapRef.current) return;

    const map = mapRef.current;
    const currentMarkerIds = new Set(markers.map(m => m.id));

    // Remove markers that are no longer in the list
    Object.keys(markersLayerRef.current).forEach(id => {
      if (!currentMarkerIds.has(id)) {
        markersLayerRef.current[id].remove();
        delete markersLayerRef.current[id];
      }
    });

    // Add or update markers
    markers.forEach(marker => {
      const existingMarker = markersLayerRef.current[marker.id];

      if (existingMarker) {
        existingMarker.setLngLat([marker.longitude, marker.latitude]);
        existingMarker.setDraggable(canEdit);
        
        // Visual style updates...
        const el = existingMarker.getElement();
        const inner = el.querySelector('div');
        const label = el.querySelector('.marker-label');
        
        if (label) {
          label.textContent = marker.name;
        }

        if (inner) {
          inner.className = `w-10 h-10 ${marker.type === 'tree' ? 'bg-emerald-400' : 'bg-lime-400'} rounded-full flex items-center justify-center shadow-lg border-2 border-white/40 overflow-hidden transition-transform duration-200 hover:scale-110 active:scale-95`;
          
          // Update image or icon
          const img = inner.querySelector('img');
          if (marker.imageUrl) {
            if (img) {
              if (img.src !== marker.imageUrl) img.src = marker.imageUrl;
            } else {
              inner.innerHTML = '';
              const newImg = document.createElement('img');
              newImg.src = marker.imageUrl;
              newImg.className = 'w-full h-full object-cover';
              newImg.referrerPolicy = 'no-referrer';
              inner.appendChild(newImg);
            }
          } else if (img || inner.querySelector('svg')) {
            // If no image, ensure fallback icon is shown
            if (img || !inner.querySelector('svg')) {
              inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
            }
          }
        }
      } else {
        // Create custom marker element
        const el = document.createElement('div');
        el.className = 'cursor-pointer'; // Base container for MapLibre positioning
        
        // Inner wrapper for visual style and hover effects
        const inner = document.createElement('div');
        inner.className = `w-10 h-10 ${marker.type === 'tree' ? 'bg-emerald-400' : 'bg-lime-400'} rounded-full flex items-center justify-center shadow-lg border-2 border-white/40 overflow-hidden transition-transform duration-200 hover:scale-110 active:scale-95`;
        el.appendChild(inner);
        
        // Add label
        const label = document.createElement('div');
        label.className = 'marker-label absolute left-1/2 -translate-x-1/2 top-full mt-2 px-2 py-0.5 bg-black/60 backdrop-blur-md rounded text-white text-[10px] font-medium whitespace-nowrap pointer-events-none shadow-sm border border-white/10 z-50';
        label.textContent = marker.name;
        el.appendChild(label);
        
        if (marker.imageUrl) {
          const img = document.createElement('img');
          img.src = marker.imageUrl;
          img.className = 'w-full h-full object-cover';
          img.referrerPolicy = 'no-referrer';
          inner.appendChild(img);
        } else {
          // Fallback icon (simplified for DOM)
          inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
        }

        const newMarker = new maplibregl.Marker({
          element: el,
          draggable: canEdit
        })
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(map);

        // Click handler
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onMarkerClick(marker);
        });

        // Drag handlers
        newMarker.on('drag', () => {
          updateMarkerZIndices();
        });

        newMarker.on('dragend', () => {
          const lngLat = newMarker.getLngLat();
          updateMarkerZIndices();
          onUpdatePosition({
            ...marker,
            longitude: lngLat.lng,
            latitude: lngLat.lat
          });
        });

        markersLayerRef.current[marker.id] = newMarker;
      }
    });

    // Update z-indices after sync
    updateMarkerZIndices();

    // Initial fit bounds when markers are first loaded
    if (!hasInitialFit.current && markers.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      markers.forEach(m => bounds.extend([m.longitude, m.latitude]));
      map.fitBounds(bounds, { padding: 100, maxZoom: 17, animate: false });
      hasInitialFit.current = true;
    }
  }, [isMapLoaded, markers, canEdit, onMarkerClick, onUpdatePosition]);

  const isLoading = !isMapLoaded || isDataLoading;

  // Trigger animation complete when loading finishes
  useEffect(() => {
    if (!isLoading && onAnimationComplete) {
      onAnimationComplete();
    }
  }, [isLoading, onAnimationComplete]);

  const togglePitch = () => {
    if (!mapRef.current) return;
    const currentPitch = mapRef.current.getPitch();
    const newPitch = currentPitch > 0 ? 0 : 45;
    mapRef.current.easeTo({
      pitch: newPitch,
      duration: 800
    });
  };

  const resetView = () => {
    if (!mapRef.current || markers.length === 0) {
      if (mapRef.current) {
        mapRef.current.easeTo({
          center: INITIAL_CENTER,
          zoom: INITIAL_ZOOM,
          pitch: 45,
          bearing: 0,
          duration: 1000
        });
      }
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    markers.forEach(m => bounds.extend([m.longitude, m.latitude]));
    
    mapRef.current.fitBounds(bounds, {
      padding: 100,
      maxZoom: 20,
      duration: 1000,
      pitch: 45
    });
  };

  return (
    <div className={`relative w-full h-full ${showLabels ? 'show-labels' : ''}`}>
      <div ref={containerRef} className="w-full h-full bg-gray-900" />
      
      {/* Bottom Controls */}
      <div className="absolute bottom-6 right-6 z-[2000] flex flex-col gap-3">
        <button
          onClick={togglePitch}
          className="w-12 h-12 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-all shadow-xl pointer-events-auto group"
          title={isAngled ? "Top-down View" : "Angled View"}
        >
          <Layers 
            size={20} 
            className={`transition-transform duration-500 ${isAngled ? 'rotate-0' : 'rotate-180'}`} 
          />
        </button>
        <button
          onClick={resetView}
          className="w-12 h-12 bg-black/40 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-center text-white/80 hover:text-white hover:bg-black/60 transition-all shadow-xl pointer-events-auto group"
          title="Reset View"
        >
          <Home size={20} className="group-hover:scale-110 transition-transform" />
        </button>
      </div>

      <style>{`
        .marker-label {
          opacity: 0;
          transform: translateY(-4px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .show-labels .marker-label {
          opacity: 1;
          transform: translateY(0);
        }
      `}</style>

      <AnimatePresence>
        {isLoading && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
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

      {/* Zoom Level Indicator */}
      <div className="absolute bottom-6 left-6 z-[2000] flex flex-col gap-2 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-mono font-medium text-white/80 uppercase tracking-widest">
            Zoom {displayZoom.toFixed(1)}
          </span>
        </div>
      </div>
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Handle Anonymous Auth
  useEffect(() => {
    setIsAuthenticating(true);
    signInAnonymously(auth)
      .then(() => {
        setIsConnected(true);
        setIsAuthenticating(false);
      })
      .catch(err => {
        setIsAuthenticating(false);
        if (err.code === 'auth/admin-restricted-operation') {
          const msg = "Anonymous Authentication is disabled in your Firebase project. Please enable it in the Firebase Console.";
          setAuthError(msg);
        } else {
          setAuthError(err.message);
        }
      });
  }, []);

  // Sync with Firestore
  useEffect(() => {
    const q = query(collection(db, 'markers'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMarkers = snapshot.docs.map(doc => doc.data() as PlantMarker);
      setMarkers(newMarkers);
      setIsConnected(true);
      setIsDataLoading(false);
      
      // Sync selected marker if it exists
      if (selectedMarker) {
        const updatedSelected = newMarkers.find(m => m.id === selectedMarker.id);
        if (updatedSelected) {
          setSelectedMarker(updatedSelected);
        }
      }
    }, (error) => {
      setIsConnected(false);
      setIsDataLoading(false);
      // Only log/throw if it's not a transient connection error
      if (!error.message.includes('unavailable') && !error.message.includes('offline')) {
        handleFirestoreError(error, OperationType.LIST, 'markers');
      } else {
        console.warn("Firestore sync paused: Connection unavailable.");
      }
    });

    return () => unsubscribe();
  }, [selectedMarker?.id]);

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
    if (!canEdit || !auth.currentUser) {
      if (!auth.currentUser) setSaveError("You must be signed in to save changes.");
      return null;
    }

    const newMarker: PlantMarker = {
      id: Math.random().toString(36).substr(2, 9),
      uid: auth.currentUser.uid,
      latitude: lngLat.lat,
      longitude: lngLat.lng,
      name: 'New Tree',
      description: '',
      imageUrl: `https://picsum.photos/seed/${Math.random()}/400/300`,
      images: [],
      createdAt: Date.now(),
      type: 'tree'
    };

    try {
      console.log("Saving new marker:", newMarker.id);
      await setDoc(doc(db, 'markers', newMarker.id), newMarker);
      setSaveError(null);
      return newMarker;
    } catch (e) {
      console.error("Failed to save new marker:", e);
      setSaveError("Failed to save. Check your connection.");
      handleFirestoreError(e, OperationType.WRITE, `markers/${newMarker.id}`);
      return null;
    }
  }, [canEdit]);

  const addMarkerAtCenter = async () => {
    if (!mapRef.current || !canEdit || !auth.currentUser) return;
    const center = mapRef.current.getCenter();
    await onMapClick({
      lat: center.lat,
      lng: center.lng
    });
  };

  const updateMarker = useCallback(async (updated: PlantMarker) => {
    if (!canEdit || !auth.currentUser) return;
    try {
      console.log("Updating marker:", updated.id);
      await setDoc(doc(db, 'markers', updated.id), updated, { merge: true });
      setSelectedMarker(updated);
      setSaveError(null);
    } catch (e) {
      console.error("Failed to update marker:", e);
      setSaveError("Failed to update. Check your connection.");
      handleFirestoreError(e, OperationType.WRITE, `markers/${updated.id}`);
    }
  }, [canEdit]);

  const updatePosition = useCallback(async (updated: PlantMarker) => {
    if (!canEdit || !auth.currentUser) return;
    try {
      await setDoc(doc(db, 'markers', updated.id), updated, { merge: true });
      setSaveError(null);
    } catch (e) {
      setSaveError("Failed to move marker.");
      handleFirestoreError(e, OperationType.WRITE, `markers/${updated.id}`);
    }
  }, [canEdit]);

  const deleteMarker = useCallback(async (id: string) => {
    if (!canEdit || !auth.currentUser) return;
    
    try {
      await deleteDoc(doc(db, 'markers', id));
      setSelectedMarker(null);
      setSaveError(null);
    } catch (e) {
      setSaveError("Failed to delete marker.");
      handleFirestoreError(e, OperationType.DELETE, `markers/${id}`);
    }
  }, [canEdit]);

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <MapComponent 
        markers={markers}
        onMarkerClick={setSelectedMarker}
        selectedMarker={selectedMarker}
        onClosePopup={() => setSelectedMarker(null)}
        onUpdatePosition={updatePosition}
        deleteMarker={deleteMarker}
        mapRef={mapRef}
        canEdit={canEdit}
        isDataLoading={isDataLoading}
        onAnimationComplete={() => {
          if (!localStorage.getItem('welcome_shown')) {
            setShowWelcome(true);
          }
        }}
      />

      {/* Welcome Popup */}
      <AnimatePresence>
        {showWelcome && (
          <div className="absolute inset-0 z-[9000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-[32px] shadow-2xl max-w-md w-full text-center relative overflow-hidden"
            >
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="w-20 h-20 bg-emerald-500/20 rounded-3xl flex items-center justify-center mx-auto mb-8 rotate-3">
                <MapIcon className="text-emerald-500" size={40} />
              </div>

              <h2 className="text-3xl font-bold text-white mb-4 tracking-tight">Welcome to the Garden</h2>
              
              <div className="space-y-6 text-left mb-10">
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-emerald-500 font-bold text-xs">01</span>
                  </div>
                  <div>
                    <h4 className="text-white font-medium text-sm mb-1">Explore the Space</h4>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Click and drag to pan the map. Use your mouse wheel or pinch to zoom.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-emerald-500 font-bold text-xs">02</span>
                  </div>
                  <div>
                    <h4 className="text-white font-medium text-sm mb-1">Discover Plants</h4>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      Click on any leaf icon to view photos and details about the plants.
                    </p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  setShowWelcome(false);
                  localStorage.setItem('welcome_shown', 'true');
                }}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-semibold transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Status & Controls Rail */}
      <div className="absolute top-0 left-0 z-[2000] flex flex-col gap-4 p-4">
        {authError && (
          <div className="p-2 bg-red-500/20 backdrop-blur-md border border-red-500/30 rounded-lg text-red-200 text-[10px] max-w-[150px] flex items-start gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{authError}</span>
          </div>
        )}

        {saveError && (
          <div className="p-2 bg-red-500/20 backdrop-blur-md border border-red-500/30 rounded-lg text-red-200 text-[10px] max-w-[150px] flex items-start gap-2 animate-pulse">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>{saveError}</span>
          </div>
        )}

        {!isUnlocked ? (
          <button 
            onClick={() => setShowUnlockConfirm(true)}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white/40 hover:text-white transition-all active:scale-95 group border border-white/10"
            title="Unlock Editing"
          >
            <Pencil size={18} className="group-hover:scale-110 transition-transform" />
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <button 
              onClick={addMarkerAtCenter}
              disabled={!isConnected}
              className={`h-10 px-4 ${isConnected ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-gray-700 cursor-not-allowed'} backdrop-blur-md border border-emerald-500/30 rounded-full flex items-center gap-2 text-white transition-all active:scale-95 shadow-xl`}
            >
              <Plus size={18} strokeWidth={2} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Add New Tree</span>
            </button>
            <button 
              onClick={handleLockEditing}
              className="h-10 px-4 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2 text-white/60 hover:text-white transition-all active:scale-95 shadow-lg"
            >
              <ShieldCheck size={18} strokeWidth={1.5} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Return to View</span>
            </button>
            <button 
              onClick={() => setShowInstructions(true)}
              className="h-10 px-4 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2 text-white/60 hover:text-white transition-all active:scale-95 shadow-lg"
            >
              <Info size={18} strokeWidth={1.5} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Instructions</span>
            </button>
          </div>
        )}
      </div>

      {/* Instructions Popup */}
      <AnimatePresence>
        {showInstructions && (
          <div className="absolute inset-0 z-[9000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-[32px] shadow-2xl max-w-md w-full relative overflow-hidden"
            >
              <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
              
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-white tracking-tight">How to Edit</h2>
                <button 
                  onClick={() => setShowInstructions(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4 mb-8">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Adding Plants</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Click the <span className="text-emerald-400 font-bold">"Add New Tree"</span> button to drop a marker at the center of your screen.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Moving Markers</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    In edit mode, you can <span className="text-emerald-400 font-bold">click and drag</span> any marker on the map to reposition it.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Editing Details</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Click a marker to open its popup. You can change the name, description, and upload up to 5 photos.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Photo Management</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    <span className="text-emerald-400 font-bold">Drag photos</span> in the edit view to reorder them. The first photo becomes the "Main" hero image.
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowInstructions(false)}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-semibold transition-all shadow-lg active:scale-[0.98]"
              >
                Got it, thanks!
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Unlock Confirmation Popup */}
      <AnimatePresence>
        {showUnlockConfirm && (
          <div className="absolute inset-0 z-[9000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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

      {/* Popup Overlay */}
      <AnimatePresence mode="wait">
        {selectedMarker && (
          <div className="absolute inset-y-0 right-0 z-[5000] pointer-events-none flex items-center justify-end p-6 md:p-12">
            <div className="pointer-events-auto">
              <PlantPopup
                key={selectedMarker.id}
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
