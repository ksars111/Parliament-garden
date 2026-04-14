import React, { useState, useCallback, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Leaf, Plus, Map as MapIcon, X, Pencil, ShieldCheck, Copy, Check } from 'lucide-react';
import { PlantMarker } from '../types';
import { PlantPopup } from './PlantPopup';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from './ErrorBoundary';
import initialMarkers from '../data/markers.json';

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
  isSyncing?: boolean;
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
  isSyncing = false,
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
            tiles: [
              'https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
              'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
              'https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
              'https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
            ],
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
      pitch: 45,
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
        existingMarker.setLngLat([marker.longitude, marker.latitude]);
        existingMarker.setDraggable(canEdit);
      } else {
        const el = document.createElement('div');
        el.className = 'cursor-pointer';
        
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
          inner.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`;
        }

        const newMarker = new maplibregl.Marker({
          element: el,
          draggable: canEdit
        })
          .setLngLat([marker.longitude, marker.latitude])
          .addTo(map);

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onMarkerClick(marker);
        });

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

      <div className="absolute bottom-6 left-6 z-10 flex flex-col gap-2 pointer-events-none">
        {isSyncing && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="bg-emerald-500/90 backdrop-blur-md border border-emerald-400/30 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-lg"
          >
            <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
            <span className="text-[10px] font-mono font-bold text-white uppercase tracking-widest">
              Syncing to File...
            </span>
          </motion.div>
        )}
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
  const [markers, setMarkers] = useState<PlantMarker[]>(initialMarkers as PlantMarker[]);
  
  // Detect if we are in the AI Studio editor environment or local dev
  const isEditorEnv = typeof window !== 'undefined' && (
    window.location.hostname.includes('ais-dev-') || 
    window.location.hostname.includes('localhost') || 
    window.location.hostname.includes('0.0.0.0')
  );

  const [isUnlocked, setIsUnlocked] = useState(isEditorEnv);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Fetch markers on load
  useEffect(() => {
    if (isEditorEnv) {
      fetchMarkers();
    }
    if (!localStorage.getItem('welcome_shown')) {
      setShowWelcome(true);
    }
  }, [isEditorEnv]);

  const copyData = () => {
    const data = JSON.stringify(markers, null, 2);
    navigator.clipboard.writeText(data);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchMarkers = async () => {
    try {
      const response = await fetch('/api/markers');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      setMarkers(data);
    } catch (error) {
      console.error("Failed to fetch markers from API:", error);
    }
  };

  const saveMarkers = async (updatedMarkers: PlantMarker[]) => {
    if (!isEditorEnv) return;
    setIsSyncing(true);
    try {
      const response = await fetch('/api/markers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedMarkers),
      });
      if (!response.ok) throw new Error('Failed to save');
    } catch (error) {
      console.error("Failed to save markers:", error);
    } finally {
      setTimeout(() => setIsSyncing(false), 500);
    }
  };

  const selectedMarker = markers.find(m => m.id === selectedMarkerId) || null;
  const canEdit = isUnlocked;

  const addMarkerAtCenter = async () => {
    if (!mapRef.current || !canEdit) return;
    const center = mapRef.current.getCenter();
    
    const newMarker: PlantMarker = {
      id: Math.random().toString(36).substr(2, 9),
      uid: 'public',
      latitude: center.lat,
      longitude: center.lng,
      name: 'New Tree',
      description: '',
      imageUrl: `https://picsum.photos/seed/${Math.random()}/400/300`,
      createdAt: Date.now(),
      type: 'tree'
    };
    
    setMarkers(prev => {
      const updated = [...prev, newMarker];
      saveMarkers(updated);
      return updated;
    });
    setSelectedMarkerId(newMarker.id);
  };

  const updateMarker = async (updated: PlantMarker) => {
    if (!canEdit) return;
    setMarkers(prev => {
      const updatedList = prev.map(m => m.id === updated.id ? updated : m);
      saveMarkers(updatedList);
      return updatedList;
    });
  };

  const deleteMarker = async (id: string) => {
    if (!canEdit) return;
    setMarkers(prev => {
      const updatedList = prev.filter(m => m.id !== id);
      saveMarkers(updatedList);
      return updatedList;
    });
    setSelectedMarkerId(null);
  };

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <MapComponent 
        markers={markers}
        onMarkerClick={(m) => setSelectedMarkerId(m.id)}
        selectedMarker={selectedMarker}
        onClosePopup={() => setSelectedMarkerId(null)}
        onUpdatePosition={updateMarker}
        deleteMarker={deleteMarker}
        mapRef={mapRef}
        canEdit={canEdit}
        isSyncing={isSyncing}
      />

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
                    <p className="text-gray-400 text-xs leading-relaxed">Click and drag to pan the map. Use your mouse wheel or pinch to zoom.</p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-1">
                    <span className="text-emerald-500 font-bold text-xs">02</span>
                  </div>
                  <div>
                    <h4 className="text-white font-medium text-sm mb-1">Discover Plants</h4>
                    <p className="text-gray-400 text-xs leading-relaxed">Click on any leaf icon to view photos and details about the plants.</p>
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

      {isEditorEnv && (
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
                onClick={() => setIsUnlocked(false)}
                className="w-10 h-10 bg-white/5 hover:bg-white/10 backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-all active:scale-95 shadow-lg"
                title="Lock Editing"
              >
                <ShieldCheck size={18} strokeWidth={1.5} />
              </button>
              <button 
                onClick={copyData}
                className={`w-10 h-10 ${copied ? 'bg-emerald-500' : 'bg-white/5 hover:bg-white/10'} backdrop-blur-md border border-white/10 rounded-full flex items-center justify-center text-white transition-all active:scale-95 shadow-lg`}
                title="Copy Data for GitHub"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {selectedMarker && (
          <div className="absolute inset-y-0 right-0 z-40 pointer-events-none flex items-center justify-end p-6 md:p-12">
            <div className="pointer-events-auto">
              <PlantPopup
                marker={selectedMarker}
                onSave={updateMarker}
                onDelete={deleteMarker}
                onClose={() => setSelectedMarkerId(null)}
                canEdit={canEdit}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
