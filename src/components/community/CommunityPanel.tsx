import { useState, useEffect } from 'react';
import { useCommunityStore } from '../../stores/communityStore';
import { useChallengeStore } from '../../stores/challengeStore';
import { communityService } from '../../services/communityService';
import { CircuitGallery } from './CircuitGallery';
import { ChallengeBoard } from './ChallengeBoard';
import { UserProfile } from './UserProfile';
import { Tabs, type TabOption } from '../ui';

import { TYPOGRAPHY } from '../../styles/tokens';
type Tab = 'gallery' | 'challenges' | 'profile';

const TABS: ReadonlyArray<TabOption<Tab>> = [
  { value: 'gallery', label: 'Gallery' },
  { value: 'challenges', label: 'Challenges' },
  { value: 'profile', label: 'Profile' },
];

export function CommunityPanel() {
  const [activeTab, setActiveTab] = useState<Tab>('gallery');
  const setCircuits = useCommunityStore((s) => s.setCircuits);
  const setChallenges = useChallengeStore((s) => s.setChallenges);
  const setLeaderboard = useChallengeStore((s) => s.setLeaderboard);

  useEffect(() => {
    // Guard against a rejection + a late resolve after unmount. Harmless today
    // (the service is local) but correct the moment it's wired to a backend.
    let cancelled = false;
    (async () => {
      try {
        const [circuits, challenges] = await Promise.all([
          communityService.getGalleryCircuits(),
          communityService.getChallenges(),
        ]);
        if (cancelled) return;
        setCircuits(circuits);
        setChallenges(challenges);
        if (challenges.length > 0) {
          const board = await communityService.getLeaderboard(challenges[0].id);
          if (!cancelled) setLeaderboard(board);
        }
      } catch {
        // Nothing to show is fine — the panels render their empty states.
      }
    })();
    return () => { cancelled = true; };
  }, [setCircuits, setChallenges, setLeaderboard]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: TYPOGRAPHY.fontSans,
      }}
    >
      <Tabs aria-label="Community sections" value={activeTab} options={TABS} onChange={setActiveTab} />

      {/* Tab content */}
      <div role="tabpanel" aria-label={`${activeTab} panel`} style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
        {activeTab === 'gallery' && <CircuitGallery />}
        {activeTab === 'challenges' && <ChallengeBoard />}
        {activeTab === 'profile' && <UserProfile />}
      </div>
    </div>
  );
}
