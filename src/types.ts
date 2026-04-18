export interface PlantImage {
  url: string;
  label?: string;
}

export interface PlantMarker {
  id: string;
  uid: string;
  latitude: number;
  longitude: number;
  name: string;
  botanicalName?: string;
  description: string;
  imageUrl: string;
  imageLabel?: string;
  images?: PlantImage[];
  createdAt: number;
  type: 'tree' | 'plant';
}

export interface Snapshot {
  id: string;
  uid: string;
  name: string;
  createdAt: number;
  markers: PlantMarker[];
}
