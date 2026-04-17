import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Trash2, Camera, Upload, Maximize2, ChevronLeft, ChevronRight, Plus as PlusIcon, Tag, GripVertical, ImageUp } from 'lucide-react';
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
  const [description, setDescription] = useState(marker.description);
  const [imageUrl, setImageUrl] = useState(marker.imageUrl);
  const [imageLabel, setImageLabel] = useState(marker.imageLabel || '');
  const [images, setImages] = useState<PlantImage[]>(() => {
    if (!marker.images) return [];
    return marker.images.map(img => typeof img === 'string' ? { url: img } : img);
  });
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [type, setType] = useState(marker.type);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const allImages = [
    imageUrl ? { url: imageUrl, label: imageLabel } : null,
    ...images
  ].filter((img): img is PlantImage => img !== null);

  // Sync state when marker changes (e.g. background update)
  React.useEffect(() => {
    setName(marker.name);
    setDescription(marker.description);
    setImageUrl(marker.imageUrl);
    setImageLabel(marker.imageLabel || '');
    setImages(marker.images?.map(img => typeof img === 'string' ? { url: img } : img) || []);
    setType(marker.type);
  }, [marker]);

  // Auto-save effect
  React.useEffect(() => {
    if (!canEdit) return;

    // Skip if values haven't changed from the prop to avoid loops
    if (
      name === marker.name &&
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
      onSave({ ...marker, name, description, imageUrl, imageLabel, images, type });
      setIsSaving(false);
    }, 1000); // 1 second debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [name, description, imageUrl, imageLabel, images, type, marker, onSave, canEdit]);

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
        setError(err instanceof Error ? err.message : "Failed to upload image. Please check your connection.");
      } finally {
        setIsUploading(false);
      }
    }
  };

  const nextImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setCurrentImageIndex((prev) => (prev + 1) % allImages.length);
  };

  const prevImage = (e?: React.MouseEvent) => {
    e?.stopPropagation();
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

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        className="bg-white rounded-2xl shadow-2xl overflow-hidden w-80 max-w-full max-h-[90vh] border border-gray-100 flex flex-col"
      >
        <div className="relative h-64 shrink-0 bg-gray-200 group overflow-hidden">
          {allImages.length > 0 ? (
            <div className="relative w-full h-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={allImages[currentImageIndex].url}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="w-full h-full relative"
                >
                  <img 
                    src={allImages[currentImageIndex].url} 
                    alt={name} 
                    className={`w-full h-full object-cover transition-opacity duration-300 ${isUploading ? 'opacity-50' : 'opacity-100'}`}
                    referrerPolicy="no-referrer"
                  />
                  {allImages[currentImageIndex].label && (
                    <div className="absolute top-3 left-3 px-2 py-1 bg-black/40 backdrop-blur-md rounded-md text-white text-[10px] font-bold uppercase tracking-wider">
                      {allImages[currentImageIndex].label}
                    </div>
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
                      <div 
                        key={i} 
                        className={`w-1.5 h-1.5 rounded-full transition-all ${i === currentImageIndex ? 'bg-white w-3' : 'bg-white/40'}`}
                      />
                    ))}
                  </div>
                </>
              )}

              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                </div>
              )}
              <button
                onClick={() => setIsModalOpen(true)}
                className="absolute bottom-3 right-3 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-lg text-white opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0"
                title="Expand view"
              >
                <Maximize2 size={18} />
              </button>
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-50">
              {isUploading ? (
                <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
              ) : (
                <Camera size={48} strokeWidth={1} />
              )}
            </div>
          )}
          <button 
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 bg-black/20 hover:bg-black/40 backdrop-blur-md rounded-full text-white transition-colors"
          >
            <X size={18} />
          </button>

          {error && (
            <div className="absolute inset-x-0 top-0 p-2 bg-red-500 text-white text-[10px] font-bold text-center animate-in fade-in slide-in-from-top-2">
              {error}
            </div>
          )}
        </div>

        <div className="p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {canEdit ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setType('plant')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${type === 'plant' ? 'bg-lime-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    Plant
                  </button>
                  <button
                    onClick={() => setType('tree')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${type === 'tree' ? 'bg-emerald-400 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    Tree
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Plant Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                  placeholder="Enter plant name..."
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm resize-none"
                  placeholder="Describe the plant..."
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Images & Labels (Cloudinary)</label>
                {!isConfigured && (
                  <div className="mb-2 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                    <p className="text-[10px] text-amber-700 leading-tight">
                      <strong>Cloudinary not configured!</strong> Please add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to your environment variables.
                    </p>
                  </div>
                )}
                <div className="space-y-3">
                  <Reorder.Group 
                    axis="x" 
                    values={allImages} 
                    onReorder={handleReorder}
                    className="flex gap-3 overflow-x-auto pb-2 custom-scrollbar"
                  >
                    {allImages.map((img, idx) => (
                      <Reorder.Item 
                        key={img.url} 
                        value={img}
                        className="relative shrink-0 w-24 h-24 rounded-xl overflow-hidden border border-gray-200 group flex flex-col cursor-grab active:cursor-grabbing"
                      >
                        <img src={img.url} alt="" className="w-full h-full object-cover pointer-events-none" />
                        
                        <div className="absolute top-1 left-1 p-1 bg-black/40 backdrop-blur-md rounded text-white opacity-0 group-hover:opacity-100 transition-opacity">
                          <GripVertical size={10} />
                        </div>

                        {idx === 0 && (
                          <div className="absolute top-1 right-1 px-1.5 py-0.5 bg-emerald-500 text-white text-[8px] font-bold uppercase rounded shadow-sm">
                            Main
                          </div>
                        )}

                        <div className="absolute inset-x-0 bottom-0 p-1.5 bg-black/60 backdrop-blur-sm">
                          <input
                            type="text"
                            value={img.label || ''}
                            onChange={(e) => {
                              const newLabel = e.target.value;
                              if (idx === 0) {
                                setImageLabel(newLabel);
                              } else {
                                setImages(prev => prev.map((item, i) => i === idx - 1 ? { ...item, label: newLabel } : item));
                              }
                            }}
                            className="w-full bg-transparent border-none text-white text-[8px] font-bold uppercase placeholder:text-white/40 focus:ring-0 p-0"
                            placeholder="Add label..."
                          />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (idx === 0) {
                              setImageUrl(images[0]?.url || '');
                              setImageLabel(images[0]?.label || '');
                              setImages(prev => prev.slice(1));
                            } else {
                              setImages(prev => prev.filter((_, i) => i !== idx - 1));
                            }
                          }}
                          className="absolute bottom-1 right-1 p-1 bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={10} />
                        </button>
                      </Reorder.Item>
                    ))}
                    <button
                      disabled={!isConfigured || isUploading}
                      onClick={() => fileInputRef.current?.click()}
                      className={`shrink-0 w-24 h-24 rounded-xl border-2 border-dashed flex flex-col items-center justify-center transition-all ${
                        !isConfigured || isUploading 
                          ? 'bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed' 
                          : 'border-gray-200 text-gray-400 hover:border-emerald-500 hover:text-emerald-500'
                      }`}
                    >
                      {isUploading ? (
                        <div className="w-6 h-6 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                      ) : (
                        <>
                          <ImageUp size={24} />
                          <span className="text-[8px] font-bold uppercase mt-1">Upload</span>
                        </>
                      )}
                    </button>
                  </Reorder.Group>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => onDelete(marker.id)}
                  className="p-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg transition-colors"
                  title="Delete marker"
                >
                  <Trash2 size={18} />
                </button>
                
                <div className="flex items-center gap-2">
                  <AnimatePresence>
                    {isSaving && (
                      <motion.div
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-emerald-600"
                      >
                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                        Saving...
                      </motion.div>
                    )}
                  </AnimatePresence>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 leading-tight">{name || 'Unnamed Plant'}</h3>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md ${type === 'tree' ? 'bg-emerald-100 text-emerald-600' : 'bg-lime-100 text-lime-600'}`}>
                  {type}
                </span>
              </div>
              <div className="mt-1 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {description || 'No description provided yet.'}
                  </p>
                </div>
                <div className="pt-2 border-t border-gray-100" />
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
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-8 bg-black/90 backdrop-blur-sm"
            onClick={() => setIsModalOpen(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl overflow-hidden max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="md:w-1/2 h-[50vh] md:h-auto md:min-h-[600px] bg-gray-900 relative flex flex-col">
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
                        <img 
                          src={allImages[currentImageIndex].url} 
                          alt={name} 
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

                  {allImages.length > 1 && (
                    <>
                      <button
                        onClick={prevImage}
                        className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all hover:scale-110"
                      >
                        <ChevronLeft size={24} />
                      </button>
                      <button
                        onClick={nextImage}
                        className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white transition-all hover:scale-110"
                      >
                        <ChevronRight size={24} />
                      </button>
                    </>
                  )}
                </div>

                {allImages.length > 1 && (
                  <div className="h-24 bg-black/20 backdrop-blur-md p-4 flex gap-3 overflow-x-auto custom-scrollbar shrink-0">
                    {allImages.map((img, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCurrentImageIndex(idx)}
                        className={`relative shrink-0 w-16 h-16 rounded-xl overflow-hidden border-2 transition-all ${idx === currentImageIndex ? 'border-emerald-500 scale-105 shadow-lg shadow-emerald-500/20' : 'border-transparent opacity-50 hover:opacity-100'}`}
                      >
                        <img src={img.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}

                <button 
                  onClick={() => setIsModalOpen(false)}
                  className="absolute top-4 left-4 p-2 bg-black/40 hover:bg-black/60 backdrop-blur-md rounded-full text-white md:hidden transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
              <div className="md:w-1/2 p-8 md:p-12 overflow-y-auto flex flex-col">
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-3xl font-bold text-gray-900 leading-tight">{name || 'Unnamed Plant'}</h2>
                    <span className={`inline-block mt-2 text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${marker.type === 'tree' ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-800 text-white'}`}>
                      {marker.type}
                    </span>
                  </div>
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className="hidden md:flex p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
                <div className="prose prose-emerald max-w-none">
                  <p className="text-lg text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {description || 'No description provided yet.'}
                  </p>
                </div>
                <div className="mt-auto pt-8 border-t border-gray-100 flex items-center justify-between text-sm text-gray-400">
                  <span>Plant Documentation</span>
                  <span>{new Date(marker.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
