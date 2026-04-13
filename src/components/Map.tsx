import React, { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Leaf, Plus, Map as MapIcon, Info, List, Search, X, ChevronRight, Pencil, ShieldCheck, AlertCircle } from 'lucide-react';
import { PlantMarker } from '../types';
import { PlantPopup } from './PlantPopup';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from './ErrorBoundary';

// Parliament of Victoria, Melbourne
const INITIAL_CENTER: [number, number] = [144.9742, -37.8108];
const INITIAL_ZOOM = 17;

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
  onAnimationComplete
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(INITIAL_ZOOM);
  const markersLayerRef = useRef<Record<string, maplibregl.Marker>>({});

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
            maxzoom: 22
          }
        ]
      },
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      pitch: 45, // Slight tilt like Felt
    });

    mapRef.current = map;

    map.on('load', () => {
      setIsMapLoaded(true);
      setZoomLevel(map.getZoom());
      if (onAnimationComplete) {
        onAnimationComplete();
      }
    });

    map.on('zoom', () => {
      setZoomLevel(map.getZoom());
    });

    map.on('click', (e) => {
      // Close popup when clicking the map
      if (!e.defaultPrevented) {
        onClosePopup();
      }
    });

    return () => {
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
        // Update position if not dragging
        // Note: MapLibre handles dragging internally if enabled
        existingMarker.setLngLat([marker.longitude, marker.latitude]);
        existingMarker.setDraggable(canEdit);
      } else {
        // Create custom marker element
        const el = document.createElement('div');
        el.className = 'cursor-pointer'; // Base container for MapLibre positioning
        
        // Inner wrapper for visual style and hover effects
        const inner = document.createElement('div');
        inner.className = `w-10 h-10 ${marker.type === 'tree' ? 'bg-emerald-400' : 'bg-emerald-800'} rounded-full flex items-center justify-center shadow-lg border-2 border-white/40 overflow-hidden transition-transform duration-200 hover:scale-110 active:scale-95`;
        el.appendChild(inner);
        
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
          
          // Fly to marker
          map.flyTo({
            center: [marker.longitude, marker.latitude],
            zoom: 20,
            speed: 1.2,
            curve: 1.42
          });
        });

        // Drag handlers
        newMarker.on('dragend', () => {
          const lngLat = newMarker.getLngLat();
          onUpdatePosition({
            ...marker,
            longitude: lngLat.lng,
            latitude: lngLat.lat
          });
        });

        markersLayerRef.current[marker.id] = newMarker;
      }
    });
  }, [isMapLoaded, markers, canEdit, onMarkerClick, onUpdatePosition]);

  // Zoom to markers on initial load
  useEffect(() => {
    if (isMapLoaded && mapRef.current && markers.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      markers.forEach(m => bounds.extend([m.longitude, m.latitude]));
      mapRef.current.fitBounds(bounds, { padding: 100, maxZoom: 17 });
    }
  }, [isMapLoaded]);

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

      {/* Zoom Level Indicator */}
      <div className="absolute bottom-6 left-6 z-10 flex flex-col gap-2 pointer-events-none">
        <div className="bg-black/40 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-[10px] font-mono font-medium text-white/80 uppercase tracking-widest">
            Zoom {zoomLevel.toFixed(1)}
          </span>
        </div>
      </div>
    </div>
  );
};

export const GardenMap: React.FC = () => {
  return (
    <ErrorBoundary>
      <GardenMapContent />
    </ErrorBoundary>
  );
};

const GardenMapContent: React.FC = () => {
  const [markers, setMarkers] = useState<PlantMarker[]>(() => {
    const saved = localStorage.getItem('garden_markers');
    return saved ? JSON.parse(saved) : [];
  });
  const [isUnlocked, setIsUnlocked] = useState(true);
  const [selectedMarker, setSelectedMarker] = useState<PlantMarker | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Persist markers to localStorage
  useEffect(() => {
    localStorage.setItem('garden_markers', JSON.stringify(markers));
  }, [markers]);

  const handleUnlockEditing = () => {
    setIsUnlocked(true);
  };

  const handleLockEditing = () => {
    setIsUnlocked(false);
  };

  const canEdit = isUnlocked;

  const onMapClick = useCallback(async (lngLat: { lat: number; lng: number }) => {
    if (!canEdit) return null;

    const newMarker: PlantMarker = {
      id: Math.random().toString(36).substr(2, 9),
      uid: 'local-user',
      latitude: lngLat.lat,
      longitude: lngLat.lng,
      name: 'New Tree',
      description: '',
      imageUrl: `https://picsum.photos/seed/${Math.random()}/400/300`,
      createdAt: Date.now(),
      type: 'tree'
    };

    setMarkers(prev => [...prev, newMarker]);
    return newMarker;
  }, [canEdit]);

  const addMarkerAtCenter = async () => {
    if (!mapRef.current || !canEdit) return;
    const center = mapRef.current.getCenter();
    const marker = await onMapClick({
      lat: center.lat,
      lng: center.lng
    });
    
    if (marker) {
      setSelectedMarker(marker);
    }
  };

  const updateMarker = async (updated: PlantMarker) => {
    setMarkers(prev => prev.map(m => m.id === updated.id ? updated : m));
  };

  const updatePosition = async (updated: PlantMarker) => {
    setMarkers(prev => prev.map(m => m.id === updated.id ? updated : m));
  };

  const deleteMarker = async (id: string) => {
    setMarkers(prev => prev.filter(m => m.id !== id));
    setSelectedMarker(null);
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
        mapRef={mapRef}
        canEdit={canEdit}
        onAnimationComplete={() => {
          if (!localStorage.getItem('welcome_shown')) {
            setShowWelcome(true);
          }
        }}
      />

      {/* Welcome Popup */}
      <AnimatePresence>
        {showWelcome && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
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

      {/* Controls */}
      <div className="absolute top-0 left-0 z-10 flex flex-col gap-4 p-4">
        {!isUnlocked ? (
          <button 
            onClick={() => setIsUnlocked(true)}
            className="w-10 h-10 bg-white/5 hover:bg-white/10 backdrop-blur-md rounded-full flex items-center justify-center text-white/40 hover:text-white transition-all active:scale-95 group border border-white/10"
            title="Unlock Editing"
          >
            <Pencil size={18} className="group-hover:scale-110 transition-transform" />
          </button>
        ) : (
          <div className="flex flex-col gap-3">
            <button 
              onClick={addMarkerAtCenter}
              className="w-10 h-10 bg-emerald-500 hover:bg-emerald-600 backdrop-blur-md border border-emerald-500/30 rounded-full flex items-center justify-center text-white transition-all active:scale-95 shadow-xl"
              title="Add Tree"
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

      {/* Unlock Confirmation Popup removed for live feel */}

      {/* Popup Overlay */}
      <AnimatePresence>
        {selectedMarker && (
          <div className="absolute inset-y-0 right-0 z-40 pointer-events-none flex items-center justify-end p-6 md:p-12">
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
