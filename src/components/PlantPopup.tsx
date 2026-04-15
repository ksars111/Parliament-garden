import React, { useState, useRef, useEffect } from 'react';
import { X, Save, Trash2, Camera, Upload, Maximize2 } from 'lucide-react';
import { PlantMarker } from '../types';
import { motion, AnimatePresence } from 'motion/react';

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
  const [type, setType] = useState(marker.type);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isClamped, setIsClamped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1600;
          const MAX_HEIGHT = 1600;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Could not get canvas context'));
            return;
          }
          
          ctx.drawImage(img, 0, 0, width, height);
          
          // Start with high quality and reduce if needed to fit under 1MB
          let quality = 0.8;
          let dataUrl = canvas.toDataURL('image/jpeg', quality);
          
          // Firestore limit is 1MB, we target ~800KB for safety
          while (dataUrl.length > 1000000 && quality > 0.1) {
            quality -= 0.1;
            dataUrl = canvas.toDataURL('image/jpeg', quality);
          }
          
          resolve(dataUrl);
        };
        img.src = e.target?.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Sync state when marker changes (e.g. background update)
  React.useEffect(() => {
    setName(marker.name);
    setDescription(marker.description);
    setImageUrl(marker.imageUrl);
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
      onSave({ ...marker, name, description, imageUrl, type });
      setIsSaving(false);
    }, 1000); // 1 second debounce

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [name, description, imageUrl, type, marker, onSave, canEdit]);

  // Check for overflow to show "Show more"
  useEffect(() => {
    if (descriptionRef.current) {
      const { scrollHeight, clientHeight } = descriptionRef.current;
      setIsClamped(scrollHeight > clientHeight);
    }
  }, [description, isExpanded]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsResizing(true);
      setError(null);
      
      try {
        const resizedDataUrl = await resizeImage(file);
        setImageUrl(resizedDataUrl);
      } catch (err) {
        console.error("Resizing failed:", err);
        setError("Failed to process image. Please try another one.");
      } finally {
        setIsResizing(false);
      }
    }
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 10 }}
        className="bg-white rounded-2xl shadow-2xl overflow-y-auto w-80 max-w-full max-h-[85vh] border border-gray-100 custom-scrollbar"
      >
        <div className="relative h-80 bg-gray-200 group">
          {imageUrl ? (
            <>
              <img 
                src={imageUrl} 
                alt={name} 
                className={`w-full h-full object-cover transition-opacity duration-300 ${isResizing ? 'opacity-50' : 'opacity-100'}`}
                referrerPolicy="no-referrer"
              />
              {isResizing && (
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
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 bg-gray-50">
              {isResizing ? (
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

        <div className="p-5 space-y-4">
          {canEdit ? (
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setType('plant')}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${type === 'plant' ? 'bg-emerald-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
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
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1 block">Image</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all text-sm"
                    placeholder="URL or upload..."
                  />
                  {imageUrl && (
                    <button
                      onClick={() => setImageUrl('')}
                      className="p-2 bg-red-50 hover:bg-red-100 text-red-500 rounded-lg transition-colors"
                      title="Clear image"
                    >
                      <X size={18} />
                    </button>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
                    title="Upload image"
                  >
                    <Upload size={18} />
                  </button>
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
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md ${type === 'tree' ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-800 text-white'}`}>
                  {type}
                </span>
              </div>
              <div className="mt-1">
                  <p 
                    ref={descriptionRef}
                    className={`text-sm text-gray-600 leading-relaxed whitespace-pre-wrap ${!isExpanded ? 'line-clamp-5' : ''}`}
                  >
                    {description || 'No description provided yet.'}
                  </p>
                  {(isClamped || isExpanded) && (
                    <button
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="text-xs font-semibold text-gray-400 hover:text-emerald-600 mt-1 underline underline-offset-4 decoration-gray-200 hover:decoration-emerald-200 transition-all"
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
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
              <div className="md:w-1/2 h-[50vh] md:h-auto md:min-h-[600px] bg-gray-900 relative flex items-center justify-center">
                {imageUrl ? (
                  <img 
                    src={imageUrl} 
                    alt={name} 
                    className="w-full h-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-300">
                    <Camera size={80} strokeWidth={1} />
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
