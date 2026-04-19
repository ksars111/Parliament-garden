import React, { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Leaf, Plus, Map as MapIcon, Info, List, Search, X, ChevronRight, Pencil, ShieldCheck, AlertCircle, Home, Rotate3d, Trash2, Undo, History, Camera, Trash, Clock } from 'lucide-react';
import { PlantMarker, Snapshot } from '../types';
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
  getDoc,
  OperationType,
  handleFirestoreError,
  signInAnonymously,
  arrayUnion,
  arrayRemove
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
  onUpdatePosition: (updated: PlantMarker, skipUndo?: boolean) => void;
  deleteMarker: (id: string) => void;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  canEdit?: boolean;
  onAnimationComplete?: () => void;
  onMapLoad?: (loaded: boolean) => void;
  isDataLoading?: boolean;
}

const TREE_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="#86efac" xmlns="http://www.w3.org/2000/svg"><path d="M19.2,11.5c0-2.2-1.8-4-4-4c-0.1,0-0.2,0-0.3,0c-0.6-1.5-2.1-2.6-3.8-2.6c-2.3,0-4.2,1.9-4.2,4.2c0,0.1,0,0.2,0,0.3c-0.9,0.5-1.5,1.5-1.5,2.6c0,1.7,1.4,3.1,3.1,3.1h0.2l-1,4.9h8l-1-4.9h0.4c1.7,0,3.1-1.4,3.1-3.1Z M12,15l-1.5-3h3L12,15Z M10,12l-1-1.5h1L10,12Z M14,12l1-1.5h-1L14,12Z"/></svg>`;
const PLANT_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#f472b6" xmlns="http://www.w3.org/2000/svg"><path d="M12,22c0,0-3.5-10-1-18c2.5,8,1,18,1,18Z M12,22c0,0-7-8-3-14c4,6,3,14,3,14Z M12,22c0,0,7-8,3-14c-4,6-3,14-3,14Z M12,22c0,0-9-5-5-10c4,5,5,10,5,10Z M12,22c0,0,9-5,5-10c-4,5-5,10-5,10Z"/></svg>`;

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
  onMapLoad,
  isDataLoading = false
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [showLabels, setShowLabels] = useState(INITIAL_ZOOM > 16.5);
  const [displayZoom, setDisplayZoom] = useState(INITIAL_ZOOM);
  const [bearing, setBearing] = useState(0);
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
      
      // Pass 1: Positioning, Z-Indexing, and Visibility check
      const visibleMarkers: { 
        id: string; 
        el: HTMLElement; 
        label: HTMLElement | null; 
        icon: HTMLElement | null;
        iconRect?: DOMRect;
        zIndex: number;
      }[] = [];

      Object.entries(markersLayerRef.current).forEach(([id, marker]) => {
        const lngLat = marker.getLngLat();
        const el = marker.getElement();
        
        if (!bounds.contains(lngLat)) {
          el.style.display = 'none';
          return;
        }
        
        el.style.display = 'block';
        const point = map.project(lngLat);
        const zIndex = Math.round(point.y);
        el.style.zIndex = zIndex.toString();

        visibleMarkers.push({
          id,
          el,
          zIndex,
          label: el.querySelector('.marker-label') as HTMLElement,
          icon: el.querySelector('div:first-child') as HTMLElement
        });
      });

      // Sort by priority (closest to camera = higher Y/ZIndex)
      visibleMarkers.sort((a, b) => b.zIndex - a.zIndex);

      const occupiedRects: DOMRect[] = [];
      
      // Pass 2: Collect all icon rects (icons always take priority over labels)
      visibleMarkers.forEach(vm => {
        if (vm.icon) {
          vm.iconRect = vm.icon.getBoundingClientRect();
        }
      });

      // Pass 3: Check label collisions
      visibleMarkers.forEach(vm => {
        if (!vm.label) return;

        // Base zoom threshold check
        if (!showLabels) {
          vm.label.classList.add('occluded');
          return;
        }

        const labelRect = vm.label.getBoundingClientRect();
        
        // Helper to check intersection with a small margin
        const intersects = (r1: DOMRect, r2: DOMRect) => {
          const margin = 2;
          return !(
            r1.right + margin < r2.left - margin ||
            r1.left - margin > r2.right + margin ||
            r1.bottom + margin < r2.top - margin ||
            r1.top - margin > r2.bottom + margin
          );
        };

        let isColliding = false;

        // Check against other icons (except its own parent icon)
        for (const other of visibleMarkers) {
          if (other.id === vm.id || !other.iconRect) continue;
          if (intersects(labelRect, other.iconRect)) {
            isColliding = true;
            break;
          }
        }

        // Check against already placed labels
        if (!isColliding) {
          for (const placedRect of occupiedRects) {
            if (intersects(labelRect, placedRect)) {
              isColliding = true;
              break;
            }
          }
        }

        if (isColliding) {
          vm.label.classList.add('occluded');
        } else {
          vm.label.classList.remove('occluded');
          occupiedRects.push(labelRect);
        }
      });
    });
  }, [mapRef, showLabels]);

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
            tiles: [
              'https://mt0.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
              'https://mt1.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
              'https://mt2.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}',
              'https://mt3.google.com/vt/lyrs=s&hl=en&x={x}&y={y}&z={z}'
            ],
            tileSize: 256,
            attribution: 'Map data &copy; Google'
          }
        },
        layers: [
          {
            id: 'google-satellite-layer',
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
      maxPitch: 85,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on('load', () => {
      setIsMapLoaded(true);
      if (onMapLoad) onMapLoad(true);
      const zoom = map.getZoom();
      setShowLabels(zoom > 16.5);
      setDisplayZoom(zoom);
      setBearing(map.getBearing());
      updateMarkerZIndices();
    });

    map.on('zoom', () => {
      const zoom = map.getZoom();
      
      // Update labels state only on threshold crossing
      setShowLabels(prev => {
        const next = zoom > 16.5;
        return prev === next ? prev : next;
      });

      // Update display zoom for UI (throttled implicitly by React state batching)
      setDisplayZoom(zoom);
    });

    map.on('move', () => {
      setBearing(map.getBearing());
      updateMarkerZIndices();
    });
    map.on('rotate', () => {
      setBearing(map.getBearing());
      updateMarkerZIndices();
    });
    map.on('pitch', updateMarkerZIndices);

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
          inner.className = `flex items-center justify-center transition-transform duration-200 hover:scale-125 active:scale-95 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]`;
          inner.innerHTML = marker.type === 'tree' ? TREE_ICON : PLANT_ICON;
        }

        if (label) {
          label.textContent = marker.name;
        }
      } else {
        // Create custom marker element
        const el = document.createElement('div');
        el.className = 'cursor-pointer'; // Base container for MapLibre positioning
        
        // Inner wrapper for visual style and hover effects
        const inner = document.createElement('div');
        inner.className = `flex items-center justify-center transition-transform duration-200 hover:scale-125 active:scale-95 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]`;
        inner.innerHTML = marker.type === 'tree' ? TREE_ICON : PLANT_ICON;
        el.appendChild(inner);
        
        // Add label
        const label = document.createElement('div');
        label.className = 'marker-label absolute left-full ml-1 tracking-tight top-1/2 -translate-y-1/2 text-white text-[11px] font-bold whitespace-nowrap pointer-events-none drop-shadow-[0_1px_1px_rgba(0,0,0,1)] z-50 transition-all duration-300';
        label.style.textShadow = '0 0 3px rgba(0,0,0,0.9), 1px 1px 2px rgba(0,0,0,1)';
        label.textContent = marker.name;
        el.appendChild(label);

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

  return (
    <div className={`relative w-full h-full ${showLabels ? 'show-labels' : ''}`}>
      <div ref={containerRef} className="w-full h-full bg-gray-900" />
      
      <style>{`
        .marker-label {
          opacity: 0;
          transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .show-labels .marker-label {
          opacity: 1;
        }
        .marker-label.occluded {
          opacity: 0 !important;
          pointer-events: none;
        }
      `}</style>

      {/* Compass UI */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 z-[2000] pointer-events-none">
        <motion.button
          onClick={() => {
            if (mapRef.current) {
              mapRef.current.easeTo({ bearing: 0, duration: 800 });
            }
          }}
          style={{ rotate: -bearing }}
          whileHover={{ scale: 1.1, backgroundColor: 'rgba(0,0,0,0.2)' }}
          whileTap={{ scale: 0.95 }}
          className="pointer-events-auto w-9 h-9 bg-black/5 backdrop-blur-[2px] border border-white/5 rounded-full flex flex-col items-center justify-center text-white shadow-sm group transition-all"
          title="Reset orientation"
        >
          <div className="flex flex-col items-center -mt-0.5">
            <span className="text-[9px] font-bold text-white/40 tracking-tighter leading-none mb-0.5 group-hover:text-emerald-500 transition-colors">N</span>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-sm">
              <path d="M5 0L0 14L5 11.2L10 14L5 0Z" fill="white" fillOpacity="0.3" className="group-hover:fill-emerald-500 transition-colors"/>
              <path d="M5 0L5 11.2L10 14L5 0Z" fill="white" fillOpacity="0.1"/>
            </svg>
          </div>
        </motion.button>
      </div>

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
  const [isMapReady, setIsMapReady] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showLegend, setShowLegend] = useState(false);
  const [lastMove, setLastMove] = useState<{ id: string; prevPos: { lng: number; lat: number } } | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const legendRef = useRef<HTMLDivElement>(null);

  // Close legend on click away
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (legendRef.current && !legendRef.current.contains(event.target as Node)) {
        setShowLegend(false);
      }
    }

    if (showLegend) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showLegend]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);
  const [isWriteQuotaExceeded, setIsWriteQuotaExceeded] = useState(false);
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

  // Sync with Firestore / Shield API
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const fetchInitialData = async () => {
      setIsDataLoading(true);
      
      const tryLocalStorage = () => {
        const cached = localStorage.getItem('garden_cache');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed.markers)) {
              setMarkers(parsed.markers);
              console.log('Serving garden data from local cache (offline mode)');
              return true;
            }
          } catch (e) {
            console.error('Failed to parse garden cache:', e);
          }
        }
        return false;
      };

      try {
        // Tier 1: Try fetching from the Vercel Shield API
        const response = await fetch('/api/garden');
        
        if (response.status === 503 || response.status === 429) {
          setIsQuotaExceeded(true);
          throw new Error('Quota exceeded');
        }

        if (response.ok) {
          const data = await response.json();
          const markers = data.markers || [];
          setMarkers(markers);
          localStorage.setItem('garden_cache', JSON.stringify({ markers, timestamp: Date.now() }));
          setIsDataLoading(false);
          setIsConnected(true);
        } else {
          throw new Error('API fetch failed');
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'Quota exceeded') {
          tryLocalStorage(); // Try to show old data even if quota is hit
          setIsDataLoading(false);
          return;
        }

        console.warn('Vercel Shield API fetch failed, falling back to direct Firestore. Error:', err);
        
        // Tier 2: Fallback to direct Firestore read
        try {
          const docRef = doc(db, 'garden', 'data');
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const markers = docSnap.data().markers || [];
            setMarkers(markers);
            localStorage.setItem('garden_cache', JSON.stringify({ markers, timestamp: Date.now() }));
          }
          setIsConnected(true);
        } catch (fsErr) {
          const errorMsg = fsErr instanceof Error ? fsErr.message : String(fsErr);
          if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
            setIsQuotaExceeded(true);
          }
          
          // Tier 3: Final fallback to Local Storage if network/cloud is completely down
          tryLocalStorage();
        } finally {
          setIsDataLoading(false);
        }
      }
    };

    // If the user is an admin/unlocked, we want real-time updates
    if (isUnlocked) {
      const docRef = doc(db, 'garden', 'data');
      unsubscribe = onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setMarkers(data.markers || []);
        } else {
          setMarkers([]);
        }
        setIsConnected(true);
        setIsDataLoading(false);
      }, (error) => {
        setIsConnected(false);
        setIsDataLoading(false);
        
        const errorMsg = error instanceof Error ? error.message : String(error);
        if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
          setIsQuotaExceeded(true);
        }
        
        handleFirestoreError(error, OperationType.GET, 'garden/data');
      });
    } else {
      // For general public views, just fetch once from the Shield API
      fetchInitialData();
    }

    // Sync snapshots for the user
    let unsubscribeSnapshots: (() => void) | null = null;
    if (isUnlocked && auth.currentUser) {
      const q = query(collection(db, 'snapshots'));
      unsubscribeSnapshots = onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Snapshot));
        setSnapshots(docs.sort((a, b) => b.createdAt - a.createdAt));
      }, (error) => {
        // Silent error for snapshots if it fails (likely rules)
        console.warn("Snapshot sync failed:", error);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribeSnapshots) unsubscribeSnapshots();
    };
  }, [isUnlocked, isAuthenticating]);

  // Keep selected marker in sync with updated list
  useEffect(() => {
    if (selectedMarker) {
      const updated = markers.find(m => m.id === selectedMarker.id);
      if (updated && JSON.stringify(updated) !== JSON.stringify(selectedMarker)) {
        setSelectedMarker(updated);
      }
    }
  }, [markers, selectedMarker?.id]);

  const handleUnlockEditing = () => {
    setIsUnlocked(true);
    sessionStorage.setItem('garden_unlocked', 'true');
    setShowUnlockConfirm(false);
  };

  const handleLockEditing = () => {
    setIsUnlocked(false);
    sessionStorage.removeItem('garden_unlocked');
    setLastMove(null);
  };

  const canEdit = isUnlocked;

  const isActuallyLoading = !isMapReady || isDataLoading;

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
      botanicalName: '',
      description: '',
      imageUrl: '',
      createdAt: Date.now(),
      type: 'tree'
    };

    try {
      console.log("Saving new marker:", newMarker.id);
      await setDoc(doc(db, 'garden', 'data'), {
        markers: arrayUnion(newMarker)
      }, { merge: true });
      setSaveError(null);
      setIsWriteQuotaExceeded(false);
      return newMarker;
    } catch (e) {
      console.error("Failed to save new marker:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
        setIsWriteQuotaExceeded(true);
      }
      setSaveError("Failed to save. Check your connection.");
      handleFirestoreError(e, OperationType.WRITE, 'garden/data');
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
    const markerIndex = markers.findIndex(m => m.id === updated.id);
    if (markerIndex === -1) return;

    try {
      console.log("Updating marker:", updated.id);
      const docRef = doc(db, 'garden', 'data');
      
      // Calculate new markers list locally to save in one write
      const newMarkers = [...markers];
      newMarkers[markerIndex] = updated;
      
      await setDoc(docRef, { markers: newMarkers }, { merge: true });

      setSelectedMarker(updated);
      setSaveError(null);
      setIsWriteQuotaExceeded(false);
    } catch (e) {
      console.error("Failed to update marker:", e);
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
        setIsWriteQuotaExceeded(true);
      }
      setSaveError("Cloud quota reached. Saving disabled temporarily.");
      handleFirestoreError(e, OperationType.WRITE, 'garden/data');
    }
  }, [canEdit, markers]);

  const updatePosition = useCallback(async (updated: PlantMarker, skipUndo = false) => {
    if (!canEdit || !auth.currentUser) return;
    const markerIndex = markers.findIndex(m => m.id === updated.id);
    if (markerIndex === -1) return;

    if (!skipUndo) {
      const oldMarker = markers[markerIndex];
      setLastMove({
        id: updated.id,
        prevPos: { lng: oldMarker.longitude, lat: oldMarker.latitude }
      });
    }

    try {
      const docRef = doc(db, 'garden', 'data');
      const newMarkers = [...markers];
      newMarkers[markerIndex] = updated;
      
      await setDoc(docRef, { markers: newMarkers }, { merge: true });
      
      setSaveError(null);
      setIsWriteQuotaExceeded(false);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
        setIsWriteQuotaExceeded(true);
      }
      setSaveError("Failed to move marker.");
      handleFirestoreError(e, OperationType.WRITE, 'garden/data');
    }
  }, [canEdit, markers]);

  const undoLastMove = useCallback(async () => {
    if (!lastMove || !canEdit || !auth.currentUser) return;
    
    const marker = markers.find(m => m.id === lastMove.id);
    if (!marker) {
      setLastMove(null);
      return;
    }

    await updatePosition({
      ...marker,
      longitude: lastMove.prevPos.lng,
      latitude: lastMove.prevPos.lat
    }, true);
    
    setLastMove(null);
  }, [lastMove, canEdit, markers, updatePosition]);

  const deleteMarker = useCallback(async (id: string) => {
    if (!canEdit || !auth.currentUser) return;
    const markerToDelete = markers.find(m => m.id === id);
    if (!markerToDelete) return;
    
    try {
      await setDoc(doc(db, 'garden', 'data'), {
        markers: arrayRemove(markerToDelete)
      }, { merge: true });
      setSelectedMarker(null);
      setSaveError(null);
      setIsWriteQuotaExceeded(false);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes('Quota limit exceeded') || errorMsg.includes('Quota exceeded')) {
        setIsWriteQuotaExceeded(true);
      }
      setSaveError("Failed to delete marker.");
      handleFirestoreError(e, OperationType.DELETE, 'garden/data');
    }
  }, [canEdit, markers]);

  const createSnapshot = async () => {
    if (!auth.currentUser || markers.length === 0) return;
    setIsSavingSnapshot(true);
    try {
      const snapshotId = `snapshot_${Date.now()}`;
      const newSnapshot: Snapshot = {
        id: snapshotId,
        uid: auth.currentUser.uid,
        name: `Garden Backup (${new Date().toLocaleDateString()})`,
        createdAt: Date.now(),
        markers: markers
      };
      await setDoc(doc(db, 'snapshots', snapshotId), newSnapshot);
      setSaveError(null);
    } catch (e) {
      console.error("Failed to create snapshot:", e);
      setSaveError("Failed to save backup.");
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const restoreSnapshot = async (snapshot: Snapshot) => {
    if (!canEdit || !auth.currentUser || !window.confirm(`Restore "${snapshot.name}"? This will overwrite your current garden layout.`)) return;
    
    try {
      await setDoc(doc(db, 'garden', 'data'), {
        markers: snapshot.markers
      });
      setSaveError(null);
      setShowSnapshots(false);
    } catch (e) {
      setSaveError("Failed to restore backup.");
    }
  };

  const deleteSnapshot = async (id: string) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'snapshots', id));
    } catch (e) {
      console.error("Failed to delete snapshot:", e);
    }
  };

  const clearAllPhotos = async () => {
    if (!canEdit || !auth.currentUser || !window.confirm("Are you sure you want to delete ALL photos from ALL markers? This cannot be undone.")) return;
    
    try {
      const cleanedMarkers = markers.map(m => ({
        ...m,
        imageUrl: '',
        images: []
      }));
      
      await setDoc(doc(db, 'garden', 'data'), {
        markers: cleanedMarkers
      });
      setSaveError(null);
      alert("All photos have been cleared successfully.");
    } catch (e) {
      setSaveError("Failed to clear photos.");
      handleFirestoreError(e, OperationType.WRITE, 'garden/data');
    }
  };

  const resetView = () => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 45,
      bearing: 0,
      essential: true
    });
  };

  const toggleSnapView = () => {
    if (!mapRef.current) return;
    const currentPitch = mapRef.current.getPitch();
    const targetPitch = currentPitch > 10 ? 0 : 80;
    mapRef.current.easeTo({
      pitch: targetPitch,
      duration: 800,
      essential: true
    });
  };

  const zoomToMarker = (marker: PlantMarker) => {
    if (!mapRef.current) return;
    mapRef.current.flyTo({
      center: [marker.longitude, marker.latitude],
      zoom: 21,
      pitch: 60,
      essential: true
    });
    setShowLegend(false);
  };

  const sortedMarkers = [...markers].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="relative w-full h-[100svh] bg-gray-900 overflow-hidden overscroll-none touch-none">
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
        onMapLoad={setIsMapReady}
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
            <button 
              onClick={() => setShowSnapshots(true)}
              className="h-10 px-4 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center gap-2 text-white/60 hover:text-white transition-all active:scale-95 shadow-lg"
            >
              <History size={18} strokeWidth={1.5} />
              <span className="text-[10px] font-bold uppercase tracking-wider">Backups</span>
            </button>
          </div>
        )}
      </div>

      {/* Legend Dropdown (Top Right) */}
      <div ref={legendRef} className="absolute top-4 right-4 z-[2000] flex flex-col items-end gap-2">
        <button 
          onClick={() => setShowLegend(!showLegend)}
          className={`w-10 h-10 md:w-12 md:h-12 backdrop-blur-md border rounded-full flex items-center justify-center transition-all active:scale-95 shadow-xl ${
            showLegend 
              ? 'bg-emerald-500 border-emerald-400 text-white' 
              : 'bg-zinc-900/80 border-white/10 text-white/60 hover:text-white hover:bg-zinc-800'
          }`}
          title="Garden Legend"
        >
          <List size={20} />
        </button>

        <AnimatePresence>
          {showLegend && (
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="w-64 max-h-[70vh] bg-zinc-900/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-4 border-b border-white/5 flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-500">Alphabetical List</span>
                  <span className="text-[10px] font-medium text-white/40">{markers.length} items</span>
                </div>
                {canEdit && markers.some(m => m.imageUrl || (m.images && m.images.length > 0)) && (
                  <button
                    onClick={clearAllPhotos}
                    className="p-1.5 hover:bg-red-500/10 text-red-500/60 hover:text-red-500 rounded-lg transition-all active:scale-90 flex items-center gap-1.5 group"
                    title="Delete ALL marker photos"
                  >
                    <Trash2 size={14} />
                    <span className="text-[8px] font-bold uppercase hidden group-hover:inline">Clear All</span>
                  </button>
                )}
              </div>
              
              <div className="overflow-y-auto custom-scrollbar p-2">
                {sortedMarkers.length === 0 ? (
                  <div className="p-4 text-center text-white/30 text-xs italic">
                    No plants added yet...
                  </div>
                ) : (
                  <div className="space-y-1">
                    {sortedMarkers.map((marker) => (
                      <button
                        key={marker.id}
                        onClick={() => zoomToMarker(marker)}
                        className="w-full text-left p-3 hover:bg-white/5 rounded-xl transition-colors group flex items-center gap-3"
                      >
                        <div className={`w-3 h-3 flex items-center justify-center shrink-0 ${marker.type === 'tree' ? 'text-green-300' : 'text-pink-400'} drop-shadow-[0_1px_1px_rgba(0,0,0,0.5)]`}>
                          {marker.type === 'tree' ? (
                            <div dangerouslySetInnerHTML={{ __html: TREE_ICON.replace('width="24"', 'width="12"').replace('height="24"', 'height="12"') }} />
                          ) : (
                            <div dangerouslySetInnerHTML={{ __html: PLANT_ICON.replace('width="20"', 'width="12"').replace('height="20"', 'height="12"') }} />
                          )}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <div className="text-white text-xs font-medium truncate group-hover:text-emerald-400 transition-colors">
                            {marker.name}
                          </div>
                          <div className="text-[10px] text-white/40 uppercase tracking-tighter">
                            {marker.type}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-white/20 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Center Target Indicator (Edit Mode) */}
      <AnimatePresence>
        {canEdit && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[4000] pointer-events-none"
          >
            <div className="relative">
              <div className="w-12 h-12 border-2 border-emerald-500/30 rounded-full flex items-center justify-center">
                <div className="w-1 h-1 bg-emerald-500 rounded-full" />
              </div>
              <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px h-12 bg-emerald-500/20" />
              <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px w-12 bg-emerald-500/20" />
            </div>
            <div className="absolute top-[calc(100%+8px)] left-1/2 -translate-x-1/2 whitespace-nowrap">
              <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-[0.2em] bg-black/40 backdrop-blur-sm px-2 py-0.5 rounded-full border border-emerald-500/20">
                New Tree Placement
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Edit Actions (Bottom Center) */}
      <AnimatePresence>
        {canEdit && (
          <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-[5000] flex flex-col items-center gap-4 w-full px-4 max-w-sm">
            <div className="flex items-center gap-3">
              {lastMove && (
                <motion.button 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  onClick={undoLastMove}
                  className="h-14 px-6 bg-zinc-900/90 hover:bg-zinc-800 backdrop-blur-xl border border-white/10 rounded-2xl flex items-center gap-3 text-white transition-all active:scale-95 shadow-2xl group"
                >
                  <Undo size={20} className="text-emerald-400 group-hover:rotate-[-20deg] transition-transform" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.15em]">Undo Move</span>
                </motion.button>
              )}
              
              <button 
                onClick={addMarkerAtCenter}
                disabled={!isConnected}
                className={`h-16 px-10 ${isConnected ? 'bg-emerald-500 hover:bg-emerald-600 scale-105' : 'bg-gray-700 cursor-not-allowed opacity-50'} backdrop-blur-md rounded-[24px] flex items-center gap-4 text-white transition-all active:scale-95 shadow-[0_20px_50px_rgba(16,185,129,0.3)] group`}
              >
                <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center group-hover:rotate-90 transition-transform duration-300">
                  <Plus size={24} strokeWidth={3} />
                </div>
                <div className="flex flex-col items-start translate-y-0.5">
                  <span className="text-[12px] font-black uppercase tracking-[0.2em] leading-none">Add New Tree</span>
                  <span className="text-[9px] font-bold text-white/60 uppercase tracking-[0.1em] mt-1">Drops at Center</span>
                </div>
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Right Controls */}
      <div className="absolute bottom-8 right-6 md:bottom-10 md:right-10 z-[2000] flex flex-col gap-3 mb-[env(safe-area-inset-bottom)] mr-[env(safe-area-inset-right)]">
        <button 
          onClick={toggleSnapView}
          className="w-12 h-12 md:w-14 md:h-14 bg-zinc-900/80 hover:bg-zinc-800 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-95 shadow-2xl group"
          title="Toggle Top-down / Tilt View"
        >
          <Rotate3d size={24} className="group-hover:scale-110 transition-transform" />
        </button>
        <button 
          onClick={resetView}
          className="w-12 h-12 md:w-14 md:h-14 bg-zinc-900/80 hover:bg-zinc-800 backdrop-blur-md border border-white/10 rounded-2xl flex items-center justify-center text-white/80 hover:text-white transition-all active:scale-95 shadow-2xl group"
          title="Reset to Home View"
        >
          <Home size={24} className="group-hover:scale-110 transition-transform" />
        </button>
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
              
              <div className="space-y-4 mb-8 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Adding Trees & Plants</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Click the <span className="text-emerald-400 font-bold">"Add New Tree"</span> button. A new marker will drop exactly at the center of your screen. 
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Moving & Reverting</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    <span className="text-emerald-400 font-bold">Drag and drop</span> any icon to reposition it. If you move something by mistake, click the <span className="text-emerald-400 font-bold italic">"Undo Move"</span> button that appears in the sidebar.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Backups & Restore</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Use the <span className="text-emerald-400 font-bold">"Backups"</span> panel to save snapshots of your entire garden. You can restore an old backup at any time to undo major changes or deletions.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Editing Details</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Click an icon to open its popup. You can change names, types, add descriptions, and upload up to 5 photos. <span className="text-emerald-400 font-bold">Drag photos</span> to reorder them; the first one is the "Main" display photo.
                  </p>
                </div>

                <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
                  <h4 className="text-emerald-400 font-bold text-[10px] uppercase tracking-widest mb-2">Navigation</h4>
                  <p className="text-gray-300 text-xs leading-relaxed">
                    Use the bottom-right buttons to toggle between <span className="text-emerald-400 font-bold text-nowrap">Tilt View (3D)</span> and Top-down view, or to quickly jump back to the center of the garden.
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

      {/* Snapshots / Backups Popup */}
      <AnimatePresence>
        {showSnapshots && (
          <div className="absolute inset-0 z-[9000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-zinc-900 border border-white/10 p-8 rounded-[32px] shadow-2xl max-w-lg w-full relative overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Garden Backups</h2>
                  <p className="text-gray-400 text-xs mt-1">Revert to older versions of your garden map.</p>
                </div>
                <button 
                  onClick={() => setShowSnapshots(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-white/40 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar mb-8 space-y-3 pr-2">
                <button
                  onClick={createSnapshot}
                  disabled={isSavingSnapshot || markers.length === 0}
                  className="w-full p-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-2xl flex items-center justify-between group transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                      <Camera className="text-emerald-500" size={20} />
                    </div>
                    <div className="text-left">
                      <span className="text-white font-bold text-sm block">Create New Backup</span>
                      <span className="text-[10px] text-emerald-500/60 uppercase tracking-widest font-bold">Snapshot Current View</span>
                    </div>
                  </div>
                  {isSavingSnapshot ? (
                    <div className="w-5 h-5 border-t-2 border-emerald-500 rounded-full animate-spin" />
                  ) : (
                    <Plus className="text-emerald-500 group-hover:scale-125 transition-transform" size={20} />
                  )}
                </button>

                <div className="h-px bg-white/5 my-6" />

                {snapshots.length === 0 ? (
                  <div className="text-center py-12">
                    <History className="text-white/10 mx-auto mb-4" size={48} />
                    <p className="text-white/30 text-sm italic">No backups found yet.</p>
                  </div>
                ) : (
                  snapshots.map((snap) => (
                    <div 
                      key={snap.id}
                      className="p-4 bg-white/5 border border-white/5 rounded-2xl flex items-center justify-between group hover:border-white/10 transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                          <Clock className="text-gray-400" size={18} />
                        </div>
                        <div className="text-left">
                          <span className="text-white font-medium text-sm block truncate max-w-[180px]">{snap.name}</span>
                          <span className="text-[10px] text-gray-500 font-mono">
                            {new Date(snap.createdAt).toLocaleString()} • {snap.markers.length} items
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => restoreSnapshot(snap)}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-xl transition-all active:scale-95"
                        >
                          Restore
                        </button>
                        <button
                          onClick={() => deleteSnapshot(snap.id)}
                          className="p-2 hover:bg-red-500/10 text-white/20 hover:text-red-500 rounded-xl transition-all"
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 text-[10px] leading-relaxed text-emerald-500/70">
                <span className="font-bold uppercase tracking-widest block mb-1">Backup Strategy</span>
                Each backup saves all coordinates, names, and photo links. Restoring a backup will replace your current garden map with the version saved at that time.
              </div>
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

      {/* Global Loading Screen */}
      <AnimatePresence>
        {isActuallyLoading && !isQuotaExceeded && (
          <motion.div 
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="absolute inset-0 z-[10000] flex flex-col items-center justify-center bg-gray-900 overscroll-none touch-none"
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

      <AnimatePresence>
        {isWriteQuotaExceeded && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-[8000] w-[90%] max-w-md"
          >
            <div className="bg-orange-500/90 backdrop-blur-md text-white p-4 rounded-2xl shadow-2xl flex items-center gap-4 border border-white/20">
              <div className="bg-white/20 p-2 rounded-xl">
                <AlertCircle size={20} />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold">Write Quota Exceeded</h4>
                <p className="text-[11px] opacity-90 leading-tight mt-0.5">
                  You can't save changes right now because the daily write limit has been reached. You can still view the garden!
                </p>
              </div>
              <button 
                onClick={() => setIsWriteQuotaExceeded(false)}
                className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quota Exceeded Screen */}
      <AnimatePresence>
        {isQuotaExceeded && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[10001] flex flex-col items-center justify-center bg-zinc-950 p-6 text-center backdrop-blur-3xl"
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05),transparent_70%)]" />
            
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-zinc-900/50 border border-white/10 p-10 rounded-[40px] shadow-2xl max-w-md w-full relative overflow-hidden backdrop-blur-xl"
            >
              <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mx-auto mb-8">
                <AlertCircle className="text-emerald-500" size={40} />
              </div>

              <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">Daily Quota Reached</h2>
              
              <div className="space-y-4 text-gray-400 text-sm leading-relaxed mb-8">
                <p>
                  This project has reached the usage limits provided by the Firestore free tier.
                </p>
                <p className="text-xs opacity-60">
                  The quota will automatically reset at midnight.
                </p>
              </div>

              <div className="p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 text-left mb-8 text-[11px] leading-relaxed">
                <span className="text-emerald-400 font-bold uppercase tracking-wider block mb-1">Developer Note</span>
                Data fetching has been optimized but the free limit is currently consumed. 
                You can still view the map if it was cached locally.
              </div>

              <button
                onClick={() => window.location.reload()}
                className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-semibold transition-all shadow-lg active:scale-[0.98]"
              >
                Try Refreshing
              </button>
            </motion.div>
          </motion.div>
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
