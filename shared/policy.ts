/** Shared, server-owned policy lists so the browser never invents its own rules. */

export const VIDEO_REPORT_REASONS = [
  'Not actually a goat',
  'Animal mistreatment',
  'Spam or misleading',
  'Harassment or hate',
  'Something else',
];

export const COMMENT_REPORT_REASONS = ['Spam', 'Harassment', 'Hate speech', 'Something else'];

/** What the contact form can be used for. The server owns these ids. */
export const CONTACT_CATEGORIES = [
  {
    id: 'problem',
    label: 'Report a problem',
    hint: 'A page, upload, video or photo that is not working as it should.',
  },
  {
    id: 'person',
    label: 'Report a person',
    hint: 'Harassment, impersonation, spam or an account breaking the guidelines.',
  },
  {
    id: 'account',
    label: 'Recover an account',
    hint: 'You cannot sign in, your account was suspended, or you think it was removed by mistake.',
  },
  {
    id: 'other',
    label: 'Something else',
    hint: 'A question or a problem that does not fit the categories above.',
  },
] as const;

export type ContactCategory = (typeof CONTACT_CATEGORIES)[number]['id'];

export function contactCategory(id: string) {
  return CONTACT_CATEGORIES.find((category) => category.id === id) ?? null;
}

export const REJECTION_REASONS = [
  'Not goat-related',
  'Looks like animal mistreatment',
  'Poor video or audio quality',
  'Footage belongs to someone else',
  'Duplicate upload',
  'Caption or tags need work',
  'Something else',
];

export const GUIDELINES_SUMMARY = [
  'Goats only. Goats with other animals are fine, as long as a goat is the point.',
  'Treat animals well. No distress, injury, baiting or unsafe handling.',
  'Film your own goats, or credit the person who did.',
  'No personal information about other people, and no harassment.',
  'Every upload is watched by a human before it goes live.',
];
