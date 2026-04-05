import { useState, useEffect } from 'react';
import { useThemeStore } from '../../stores/themeStore';
import { useCommunityStore } from '../../stores/communityStore';
import { useChallengeStore } from '../../stores/challengeStore';
import { communityService } from '../../services/communityService';
import { CircuitGallery } from './CircuitGallery';
import { ChallengeBoard } from './ChallengeBoard';
import { UserProfile } from './UserProfile';

type Tab = 'gallery' | 'challenges' | 'profile';

const TABS: { value: Tab; label: string }[] = [
  { value: 'gallery', label: 'Gallery' },
  { value: 'challenges', label: 'Challenges' },
  { value: 'profile', label: 'Profile' },
];

export function CommunityPanel() {
  const colors = useThemeStore((s) => s.colors);
  const [activeTab, setActiveTab] = useState<Tab>('gallery');
  const setCircuits = useCommunityStore((s) => s.setCircuits);
  const setChallenges = useChallengeStore((s) => s.setChallenges);
  const setLeaderboard = useChallengeStore((s) => s.setLeaderboard);

  useEffect(() => {
    communityService.getGalleryCircuits().then(setCircuits);
    communityService.getChallenges().then((ch) => {
      setChallenges(ch);
      if (ch.length > 0) {
        communityService.getLeaderboard(ch[0].id).then(setLeaderboard);
      }
    });
  }, [setCircuits, setChallenges, setLeaderboard]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: "'Geist Sans', sans-serif",
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: `1px solid ${colors.border}`,
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              style={{
                flex: 1,
                padding: '8px 0',
                border: 'none',
                borderBottom: `2px solid ${active ? colors.accent : 'transparent'}`,
                background: 'transparent',
                color: active ? colors.accent : colors.textMuted,
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                fontFamily: "'Geist Sans', sans-serif",
                cursor: 'pointer',
                transition: 'color 0.15s, border-color 0.15s',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 12 }}>
        {activeTab === 'gallery' && <CircuitGallery />}
        {activeTab === 'challenges' && <ChallengeBoard />}
        {activeTab === 'profile' && <UserProfile />}
      </div>
    </div>
  );
}
