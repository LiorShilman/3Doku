import { useState } from 'react';
import { updateDisplayName, type AuthUser } from './api';

interface SettingsScreenProps {
  user: AuthUser;
  onUserUpdated: (user: AuthUser) => void;
  onNewGame: () => void;
  onExit: () => void;
}

export function SettingsScreen({ user, onUserUpdated, onNewGame, onExit }: SettingsScreenProps) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const trimmed = displayName.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= 24 && trimmed !== user.displayName;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updateDisplayName(trimmed);
      onUserUpdated(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'שגיאה בשמירה');
    } finally {
      setSaving(false);
    }
  };

  const handleNewGame = () => {
    // Always confirm, regardless of level - even a player still on level 1
    // may already have caught Pokemon (catching starts on the very first
    // correct placement, not on completing a level), so there's always
    // something a full reset could actually discard.
    if (
      !window.confirm(
        'להתחיל משחק חדש? זה יאפס את ההתקדמות חזרה לשלב 1, ימחק את כל הלוחות השמורים, את הדירוג הכללי שלך ואת אוסף הפוקימונים שלך. פעולה זו אינה הפיכה.'
      )
    ) {
      return;
    }
    onNewGame();
  };

  return (
    <div className="home-shell">
      <div className="home-card">
        <h1>⚙️ הגדרות</h1>

        <div className="settings-section">
          <h2>שם שחקן</h2>
          <div className="settings-row">
            <input
              className="race-code-input"
              style={{ textTransform: 'none', letterSpacing: 'normal', fontSize: 16 }}
              value={displayName}
              maxLength={24}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setSaved(false);
              }}
            />
            <button onClick={handleSave} className="primary" disabled={!canSave || saving}>
              {saving ? 'שומר...' : 'שמור'}
            </button>
          </div>
          {saveError && <p className="auth-error">{saveError}</p>}
          {saved && <p className="settings-saved">✓ השם עודכן</p>}
        </div>

        <div className="settings-danger-zone">
          <h2>⚠️ אזור מסוכן</h2>
          <p>איפוס המשחק ימחק את ההתקדמות בכל השלבים, את כל הלוחות השמורים, ואת הדירוג הכללי שלך. אוסף הפוקימונים לא ייפגע. אי אפשר לבטל פעולה זו.</p>
          <button onClick={handleNewGame} className="danger">
            🗑️ איפוס משחק - התחל מחדש
          </button>
        </div>

        <div className="home-actions">
          <button onClick={onExit}>חזרה לתפריט</button>
        </div>
      </div>
    </div>
  );
}
