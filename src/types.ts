export interface PlantMarker {
  id: string;
  uid: string;
  latitude: number;
  longitude: number;
  name: string;
  description: string;
  imageUrl: string;
  storageId?: string;
  createdAt: number;
  type: 'tree' | 'plant';
}
