import type { Framework } from '../../types/quantum';

export interface GalleryCircuit {
  id: string;
  title: string;
  description: string;
  author: { id: string; displayName: string };
  framework: Framework;
  code: string;
  category: 'tutorial' | 'algorithm' | 'art' | 'challenge';
  tags: string[];
  likes: number;
  createdAt: string;
  featured: boolean;
}

// Circuit sharing / publishing is not live yet — there is no backend hosting
// community-shared circuits, so this is intentionally empty. The GalleryCircuit
// type is kept (consumers import it) for when sharing ships.
export const MOCK_GALLERY: GalleryCircuit[] = [];
