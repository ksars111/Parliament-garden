import React, { useState, useRef } from 'react';
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
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync state when marker changes (e.g. background update)
  React.useEffect(() => {
    setName(marker.name);
    setDescription(marker.description);
    setImageUrl(marker.imageUrl);
    setType(marker.type);
  }, [marker]);

  const TRUNCATE_LIMIT = 150;
  const shouldTruncate = description.length > TRUNCATE_LIMIT;
  const displayDescription = (shouldTruncate && !isExpanded) 
    ? `${description.slice(0, TRUNCATE_LIMIT)}...` 
    : description;

  const handleSave = () => {
    onSave({ ...marker, name, description, imageUrl, type });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Basic size check (e.g., 800KB) to stay under Firestore 1MB limit
      if (file.size > 0.8 * 1024 * 1024) {
        setError("Image is too large. Please select an image under 800KB.");
        setTimeout(() => setError(null), 3000);
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        setImageUrl(reader.result as string);
      };
      reader.readAsDataURL(file);
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
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
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
              <Camera size={48} strokeWidth={1} />
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
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  <Save size={16} />
                  Save Changes
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 leading-tight">{name || 'Unnamed Plant'}</h3>
                <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md ${marker.type === 'tree' ? 'bg-emerald-100 text-emerald-600' : 'bg-emerald-800 text-white'}`}>
                  {marker.type}
                </span>
              </div>
              <div className="mt-1">
                  <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                    {displayDescription || 'No description provided yet.'}
                  </p>
                  {shouldTruncate && (
                    <button
                      onClick={() => setIsExpanded(!isExpanded)}
                      className="text-xs font-semibold text-gray-400 hover:text-emerald-600 mt-1 underline underline-offset-4 decoration-gray-200 hover:decoration-emerald-200 transition-all"
                    >
                      {isExpanded ? 'Show less' : 'Show more'}
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-end pt-2 border-t border-gray-100">
                  <button
                    onClick={() => onDelete(marker.id)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                    title="Delete marker"
                  >
                    <Trash2 size={18} />
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
