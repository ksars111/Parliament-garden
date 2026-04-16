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
  description: string;
  imageUrl: string;
  imageLabel?: string;
  images?: PlantImage[];
  createdAt: number;
  type: 'tree' | 'plant';
}
