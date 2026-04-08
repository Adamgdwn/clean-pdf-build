-- Add server-side onboarding tracking so the onboarding prompt follows the user across devices.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
