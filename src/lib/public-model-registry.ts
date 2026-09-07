import registry from '../config/public-model-registry.json';

export type PublicBrowserModelProfile = 'desktop' | 'mobile';

export const PUBLIC_MODEL_REGISTRY = registry;
export const DESKTOP_PUBLIC_MODEL = registry.desktop;
export const MOBILE_PUBLIC_MODEL = registry.mobile;
export const PUBLIC_HANDOFF_LAB = registry.handoffLab;

export function publicModelForProfile(profile: PublicBrowserModelProfile) {
  return profile === 'mobile' ? MOBILE_PUBLIC_MODEL : DESKTOP_PUBLIC_MODEL;
}

export function shortModelRevision(revision: string) {
  return revision.slice(0, 8);
}
