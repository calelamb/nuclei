import { MOCK_GALLERY, type GalleryCircuit } from '../data/community/mockGallery';
import { MOCK_CHALLENGES, MOCK_LEADERBOARD, type Challenge, type LeaderboardEntry } from '../data/community/mockChallenges';

export interface CommunityService {
  getGalleryCircuits(options?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<GalleryCircuit[]>;
  getCircuitById(id: string): Promise<GalleryCircuit | null>;
  getChallenges(): Promise<Challenge[]>;
  getLeaderboard(challengeId: string): Promise<LeaderboardEntry[]>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class MockCommunityService implements CommunityService {
  async getGalleryCircuits(options?: {
    category?: string;
    search?: string;
    sort?: string;
  }): Promise<GalleryCircuit[]> {
    await delay(50);

    let results = [...MOCK_GALLERY];

    if (options?.category) {
      results = results.filter((c) => c.category === options.category);
    }

    if (options?.search) {
      const query = options.search.toLowerCase();
      results = results.filter(
        (c) =>
          c.title.toLowerCase().includes(query) ||
          c.description.toLowerCase().includes(query) ||
          c.tags.some((tag) => tag.toLowerCase().includes(query)) ||
          c.author.displayName.toLowerCase().includes(query)
      );
    }

    if (options?.sort) {
      switch (options.sort) {
        case 'likes':
          results.sort((a, b) => b.likes - a.likes);
          break;
        case 'newest':
          results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'oldest':
          results.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
          break;
        case 'featured':
          results.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
          break;
        default:
          break;
      }
    }

    return results;
  }

  async getCircuitById(id: string): Promise<GalleryCircuit | null> {
    await delay(50);
    return MOCK_GALLERY.find((c) => c.id === id) ?? null;
  }

  async getChallenges(): Promise<Challenge[]> {
    await delay(50);
    return [...MOCK_CHALLENGES];
  }

  async getLeaderboard(_challengeId: string): Promise<LeaderboardEntry[]> {
    await delay(50);
    return [...MOCK_LEADERBOARD];
  }
}

export const communityService: CommunityService = new MockCommunityService();
