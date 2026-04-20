import React, { useState, useRef } from 'react';
import { X, Camera, Maximize2, ChevronLeft, ChevronRight, GripVertical, ImageUp, RotateCcw, Info, Trash2, Save, Upload, Tag, Plus as PlusIcon } from 'lucide-react';
import { PlantMarker, PlantImage } from '../types';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { uploadImage } from '../lib/cloudinary';

interface PlantPopupProps {
  marker: PlantMarker;
  onSave: (updated: PlantMarker) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  canEdit?: boolean;
}

export const PlantPopup: React.FC<PlantPopupProps> = ({ marker, onSave, onDelete, onClose, canEdit = false }) => {
  const [name, setName] = useState(marker.name);
  const [botanicalName, setBotanicalName] = useState(marker.botanicalName || '');
  const [description, setDescription] = useState(marker.description);
  const [imageUrl, setImageUrl] = useState(marker.imageUrl);
  const [imageLabel, setImageLabel] = useState(marker.imageLabel || '');
  const [images, setImages] = useState<PlantImage[]>(() => {
    if (!marker.images) return [];
    return marker.images.map(img => typeof img === 'string' ? { url: img } : img);
  });
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [direction, setDirection] = useState(0);
  const [type, setType] = useState(marker.type);
  const [aspectRatios, setAspectRatios] = useState<Record<string, number>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPhotoFocus, setIsPhotoFocus] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [zoomPosition, setZoomPosition] = useState({ x: 0, y: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const lastTouchDistance = useRef<number | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const allImages = [
    imageUrl ? { url: imageUrl, label: imageLabel } : null,
    ...images
  ].filter((img): img is PlantImage => img !== null);

  // Sync state when marker changes
  React.useEffect(() => {
    setName(marker.name);
    setBotanicalName(marker.botanicalName || '');
    setDescription(marker.description);
    setImageUrl(marker.imageUrl);
    setImageLabel(marker.imageLabel || '');
    setImages(marker.images?.map(img => typeof img === 'string' ? { url: img } : img) || []);
    setType(marker.type);
  }, [marker]);

  // Auto-save effect
  React.useEffect(() => {
    if (!canEdit) return;

    if (
      name === marker.name &&
      botanicalName === (marker.botanicalName || '') &&
      description === marker.description &&
      imageUrl === marker.imageUrl &&
      imageLabel === (marker.imageLabel || '') &&
      JSON.stringify(images) === JSON.stringify(marker.images || []) &&
      type === marker.type
    ) {
      setIsSaving(false);
      return;
    }

    setIsSaving(true);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      onSave({ ...marker, name, botanicalName, description, imageUrl, imageLabel, images, type });
      setIsSaving(false);
    }, 1000);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [name, botanicalName, description, imageUrl, imageLabel, images, type, marker, onSave, canEdit]);

  // Reset zoom when switching images
  React.useEffect(() => {
    setZoomScale(1);
    setZoomPosition({ x: 0, y: 0 });
  }, [currentImageIndex]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey || zoomScale > 1) {
      e.preventDefault();
      const delta = -e.deltaY * 0.005;
      const newScale = Math.min(Math.max(zoomScale + delta, 1), 5);
      setZoomScale(newScale);
      if (newScale === 1) setZoomPosition({ x: 0, y: 0 });
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      lastTouchDistance.current = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistance.current !== null) {
      const distance = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
      );
      
      const delta = (distance - lastTouchDistance.current) * 0.01;
      const newScale = Math.min(Math.max(zoomScale + delta, 1), 5);
      setZoomScale(newScale);
      if (newScale === 1) setZoomPosition({ x: 0, y: 0 });
      lastTouchDistance.current = distance;
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistance.current = null;
  };

  const openPhotoFocus = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale(1.5);
    setZoomPosition({ x: 0, y: 0 });
    setIsPhotoFocus(true);
    setIsModalOpen(true);
  };

  const openFullModal = (e: React.MouseEvent) => {
    e.stopPropagation();
    setZoomScale(1);
    setZoomPosition({ x: 0, y: 0 });
    setIsPhotoFocus(false);
    setIsModalOpen(true);
  };

  const handleImageLoad = (url: string, e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    setAspectRatios(prev => ({ ...prev, [url]: naturalWidth / naturalHeight }));
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (allImages.length >= 5) {
        setError("Maximum 5 photos allowed per plant.");
        return;
      }

      setIsUploading(true);
      setError(null);
      
      try {
        const cloudUrl = await uploadImage(file);
        if (!imageUrl) {
          setImageUrl(cloudUrl);
        } else {
          setImages(prev => [...prev, { url: cloudUrl }]);
        }
      } catch (err) {
        console.error("Upload failed:", err);
        setError(err instanceof Error ? err.message : "Failed to upload image.");
      } finally {
        setIsUploading(false);
      }
    }
  };

  const nextImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDirection(1);
    setCurrentImageIndex((prev) => (prev + 1) % allImages.length);
  };

  const prevImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setDirection(-1);
    setCurrentImageIndex((prev) => (prev - 1 + allImages.length) % allImages.length);
  };

  const handleReorder = (newOrder: PlantImage[]) => {
    if (newOrder.length === 0) {
      setImageUrl('');
      setImageLabel('');
      setImages([]);
      return;
    }
    const hero = newOrder[0];
    setImageUrl(hero.url);
    setImageLabel(hero.label || '');
    setImages(newOrder.slice(1));
  };

  const isConfigured = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME && import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

  const swipeVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 50 : -50,
      opacity: 0
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction > 0 ? -50 : 50,
      opacity: 0
    })
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        className="bg-white rounded-2xl shadow-[0_30px_60px_-15px_rgba(0,0,0,0.3),0_0_20px_-10px_rgba(0,0,0,0.1)] overflow-hidden w-80 max-w-full max-h-[90vh] border border-gray-200/50 flex flex-col"
      >
        <motion.div 
          layout
          className="relative shrink-0 bg-gray-100 group overflow-hidden transition-all duration-500 ease-in-out"
          style={{ 
            aspectRatio: aspectRatios[allImages[currentImageIndex]?.url] || '1/1',
            maxHeight: '65vh'
          }}
        >
          {allImages.length > 0 ? (
            <div className="relative w-full h-full">
              <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.div
                  key={allImages[currentImageIndex].url}
                  custom={direction}
                  variants={swipeVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{
                    x: { type: "spring", stiffness: 300, damping: 30 },
                    opacity: { duration: 0.2 }
                  }}
                  drag={allImages.length > 1 ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.2}
                  onDragEnd={(_, info) => {
                    if (info.offset.x < -50) nextImage();
                    else if (info.offset.x > 50) prevImage();
                  }}
                  className="w-full h-full relative overflow-hidden cursor-pointer"
                  onClick={openPhotoFocus}
                >
                  <img 
                    src={allImages[currentImageIndex].url} 
                    alt={name} 
                    onLoad={(e) => handleImageLoad(allImages[currentImageIndex].url, e)}
                    className={`w-full h-full object-contain transition-opacity duration-300 ${isUploading ? 'opacity-50' : 'opacity-100'}`}
                    referrerPolicy="no-referrer"
                    draggable={false}
                  />
                  {allImages[currentImageIndex].label && (
                    <div className="absolute top-3 left-3 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md text-white text-[10px] font-bold uppercase tracking-wider pointer-events-none">
                      {allImages[currentImageIndex].label}
                    </div>
                  )}
                  <button
                    onClick={openPhotoFocus}
                    className="absolute bottom-3 right-3 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all hover:scale-110 active:scale-95 z-20 shadow-lg"
                    title="Expand View"
                  >
                    <Maximize2 size={16} />
                  </button>

                  {canEdit && isConfigured && allImages.length > 0 && allImages.length < 5 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                      disabled={isUploading}
                      className="absolute top-4 left-4 p-2 bg-emerald-500/90 hover:bg-emerald-500 backdrop-blur-md rounded-full text-white shadow-xl transition-all active:scale-95 z-20 flex items-center gap-2 px-3"
                      title="Add Photo"
                    >
                      {isUploading ? (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <PlusIcon size={14} strokeWidth={3} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Add Photo</span>
                        </>
                      )}
                    </button>
                  )}
                </motion.div>
              </AnimatePresence>

              {allImages.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/20 hover:bg-black/40 backdrop-blur-md rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 bg-black/20 hover:bg-black/40 backdrop-blur-md rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1">
                    {allImages.map((_, i) => (
                      <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentImageIndex ? 'bg-white w-3' : 'bg-white/40'}`} />
                    ))}
                  </div>
                </>
              )}

              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
            </div>
          ) : (
            <div 
              className={`w-full h-full flex flex-col items-center justify-center bg-gray-50 transition-colors ${canEdit && isConfigured && !isUploading ? 'cursor-pointer hover:bg-gray-100' : ''}`}
              onClick={() => canEdit && isConfigured && !isUploading && fileInputRef.current?.click()}
            >
              {isUploading ? (
                <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
              ) : (
                <>
                  <Camera size={48} strokeWidth={1} className="text-gray-300 mb-2" />
                  {canEdit && isConfigured && <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Click to upload photo</span>}
                </>
              )}
            </div>
          )}
          <button 
            onClick={onClose} 
            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 backdrop-blur-xl rounded-full text-white transition-all shadow-lg active:scale-90 z-20 group"
            title="Close Popup"
          >
            <X size={20} className="group-hover:rotate-90 transition-transform duration-300" />
          </button>
          {error && <div className="absolute inset-x-0 top-0 p-2 bg-red-500 text-white text-[10px] font-bold text-center z-30">{error}</div>}
        </motion.div>

        <div className="p-5 flex-1 overflow-y-auto">
          {canEdit ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button onClick={() => setType('plant')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase ${type === 'plant' ? 'bg-pink-400 text-white' : 'bg-gray-100 text-gray-400'}`}>Plant</button>
                <button onClick={() => setType('tree')} className={`flex-1 py-1.5 rounded-lg text-xs font-bold uppercase ${type === 'tree' ? 'bg-green-400 text-white' : 'bg-gray-100 text-gray-400'}`}>Tree</button>
              </div>
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full font-bold text-lg bg-transparent border-none p-0 focus:ring-0" placeholder="Name" />
              <input value={botanicalName} onChange={(e) => setBotanicalName(e.target.value)} className="w-full italic text-sm text-gray-500 bg-transparent border-none p-0 focus:ring-0" placeholder="Botanical Name" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full text-sm text-gray-600 bg-gray-50 rounded-xl p-3 border-none focus:ring-emerald-500/20 resize-none" placeholder="Description..." />
              
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Photos ({allImages.length}/5)</span>
                  {allImages.length < 5 && isConfigured && (
                    <button 
                      onClick={() => !isUploading && fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="text-[10px] font-bold uppercase tracking-widest text-emerald-500 hover:text-emerald-600 flex items-center gap-1 transition-colors"
                    >
                      {isUploading ? 'Uploading...' : <><PlusIcon size={12} /> Add Photo</>}
                    </button>
                  )}
                </div>
                
                {allImages.length > 0 && (
                  <div className="pt-1">
                    <Reorder.Group 
                      axis="x" 
                      values={allImages} 
                      onReorder={handleReorder}
                      className="flex gap-2 p-1 overflow-x-auto custom-scrollbar pb-2"
                    >
                      {allImages.map((img, idx) => (
                        <Reorder.Item 
                          key={img.url} 
                          value={img} 
                          className="relative group/thumb shrink-0 cursor-grab active:cursor-grabbing"
                        >
                          <div className={`w-12 h-12 rounded-lg overflow-hidden border-2 transition-colors ${idx === 0 ? 'border-emerald-500 shadow-sm' : 'border-gray-100'}`}>
                            <img src={img.url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                          
                          {idx === 0 && (
                            <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[7px] font-black uppercase px-1 rounded shadow-sm z-10">
                              Main
                            </div>
                          )}

                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              const newImages = [...allImages];
                              newImages.splice(idx, 1);
                              handleReorder(newImages);
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity shadow-sm z-10"
                          >
                            <X size={10} strokeWidth={3} />
                          </button>
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>
                    <p className="text-[9px] text-gray-400 mt-1 flex items-center gap-1">
                      <GripVertical size={10} />
                      Drag to reorder. The first photo is the main display.
                    </p>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-between items-center">
                <button onClick={() => onDelete(marker.id)} className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-100 transition-colors"><Trash2 size={18} /></button>
                <div className="flex items-center gap-3 text-[10px] font-bold uppercase">
                  {isSaving && <span className="text-emerald-500 animate-pulse">Saving...</span>}
                  <button onClick={onClose} className="px-5 py-2.5 bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 transition-all active:scale-95">Done</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col">
              <div className="flex-1 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900">{name || 'Unnamed'}</h3>
                    {botanicalName && <p className="text-sm italic text-gray-500 mt-0.5">{botanicalName}</p>}
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md ${type === 'tree' ? 'bg-green-100 text-green-700' : 'bg-pink-100 text-pink-600'}`}>{type}</span>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-6">
                  {description ? (
                    description.length > 100 ? (
                      <>
                        {description.substring(0, 100)}...
                        <button onClick={openFullModal} className="text-emerald-500 font-bold ml-1 hover:underline">show more</button>
                      </>
                    ) : description
                  ) : <span className="text-gray-400 italic">No description provided.</span>}
                </p>
              </div>
              <div className="pt-4 border-t border-gray-100 mt-auto">
                <button 
                  onClick={onClose}
                  className="w-full py-3 bg-gray-900 hover:bg-black text-white rounded-xl font-bold text-[11px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98]"
                >
                  Close Information
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {isModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-8 bg-black/95 backdrop-blur-md"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`bg-white rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row transition-all duration-500 ${isPhotoFocus ? 'max-w-6xl w-[95vw] max-h-[95vh]' : 'max-w-4xl w-full max-h-[90vh]'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div 
                className={`${isPhotoFocus ? 'md:w-full' : 'md:w-1/2'} h-[60vh] md:h-auto md:min-h-[600px] bg-gray-900 relative flex flex-col touch-none transition-all duration-500`}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                ref={imageContainerRef}
              >
                <div className="flex-1 relative flex items-center justify-center overflow-hidden">
                  <AnimatePresence mode="wait">
                    {allImages.length > 0 ? (
                      <motion.div
                        key={allImages[currentImageIndex].url}
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.4 }}
                        className="w-full h-full relative"
                      >
                        <motion.img 
                          src={allImages[currentImageIndex].url} 
                          alt={name} 
                          style={{ scale: zoomScale, x: zoomPosition.x, y: zoomPosition.y, cursor: zoomScale > 1 ? 'grab' : 'default' }}
                          drag={zoomScale > 1}
                          dragMomentum={false}
                          dragElastic={0}
                          onDragEnd={(_, info) => setZoomPosition(prev => ({ x: prev.x + info.offset.x, y: prev.y + info.offset.y }))}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                        {allImages[currentImageIndex].label && (
                          <div className="absolute top-6 left-6 px-4 py-2 bg-black/40 backdrop-blur-md rounded-xl text-white text-sm font-bold uppercase tracking-widest border border-white/10">
                            {allImages[currentImageIndex].label}
                          </div>
                        )}
                      </motion.div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Camera size={80} strokeWidth={1} />
                      </div>
                    )}
                  </AnimatePresence>

                  {zoomScale > 1 && (
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex gap-2 z-10">
                      <button
                        onClick={() => { setZoomScale(1); setZoomPosition({ x: 0, y: 0 }); }}
                        className="p-2 bg-white/20 hover:bg-white/30 backdrop-blur-md rounded-full text-white flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide px-4 h-10 border border-white/10 shadow-xl"
                      >
                        <RotateCcw size={14} /> Reset Zoom
                      </button>
                    </div>
                  )}

                  {isPhotoFocus && (
                    <button
                      onClick={() => setIsPhotoFocus(false)}
                      className="absolute bottom-8 right-8 p-3 bg-emerald-500 hover:bg-emerald-600 backdrop-blur-md rounded-2xl text-white z-20 flex items-center gap-2 text-sm font-bold shadow-2xl transition-all hover:scale-105 active:scale-95"
                    >
                      <Info size={20} /> Show Details
                    </button>
                  )}

                  {allImages.length > 1 && (
                    <>
                      <button onClick={prevImage} className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all hover:scale-110"><ChevronLeft size={24} /></button>
                      <button onClick={nextImage} className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all hover:scale-110"><ChevronRight size={24} /></button>
                    </>
                  )}
                </div>

                {allImages.length > 1 && (
                  <div className="h-24 bg-black/20 backdrop-blur-md p-4 flex gap-3 overflow-x-auto custom-scrollbar shrink-0">
                    {allImages.map((img, idx) => (
                      <button key={idx} onClick={() => setCurrentImageIndex(idx)} className={`relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${idx === currentImageIndex ? 'border-emerald-500 scale-105 shadow-lg shadow-emerald-500/20' : 'border-transparent opacity-50 hover:opacity-100'}`}>
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                <button onClick={() => setIsModalOpen(false)} className="absolute top-4 left-4 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white md:hidden"><X size={24} /></button>
              </div>
              {!isPhotoFocus && (
                <div className="md:w-1/2 p-10 md:p-14 overflow-y-auto flex flex-col animate-in fade-in slide-in-from-right-8 duration-500">
                  <div className="flex justify-between items-start mb-8">
                    <div>
                      <h2 className="text-4xl font-bold text-gray-900 leading-tight tracking-tight">{name || 'Unnamed Plant'}</h2>
                      {botanicalName && <p className="text-xl text-emerald-600 italic mt-1 font-medium">{botanicalName}</p>}
                      <span className={`inline-block mt-6 text-[10px] font-bold uppercase tracking-[0.2em] px-3.5 py-1.5 rounded-full ${marker.type === 'tree' ? 'bg-green-100 text-green-700' : 'bg-pink-100 text-pink-600'}`}>{marker.type}</span>
                    </div>
                    <button onClick={() => setIsModalOpen(false)} className="hidden md:flex p-2 hover:bg-gray-100 rounded-full text-gray-300 hover:text-gray-600 transition-colors"><X size={28} /></button>
                  </div>
                  <div className="prose prose-emerald max-w-none">
                    <p className="text-lg text-gray-600 leading-relaxed whitespace-pre-wrap">{description || 'No description provided.'}</p>
                  </div>
                  <div className="mt-auto pt-10 border-t border-gray-100 flex items-center justify-between text-xs font-bold uppercase tracking-widest text-gray-300">
                    <span>Plant ID: {marker.id.substring(0, 8)}</span>
                    <span>{new Date(marker.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
    </>
  );
};
