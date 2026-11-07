// Server-owned policy: limits, categories, recommendation weights.

export const limits = {
  maxPhotos: 6,
  maxPhotoMb: 1.8,
  maxAudioMb: 1.5,
  maxAvatarMb: 0.4,
  maxCaptionLength: 300,
  maxBioLength: 200,
  maxCommentsPerMinute: 12,
  maxPostsPerHour: 8,
  /** Minimum age for an account. Enforced on sign-up, never shown publicly. */
  minAge: 13,
  feedPageSize: 6,
  commentsPageSize: 20,
  // Video bytes live in chunked D1 rows, so the ceiling is generous but finite.
  maxVideoMb: 25,
  maxDurationSeconds: 180,
  minDurationSeconds: 1,
};

/** Size of one stored video chunk. Kept well under D1's 2 MB row limit. */
export const VIDEO_CHUNK_BYTES = 768 * 1024;

/**
 * The storage budget the admin meter measures against. Workers Free caps a
 * single D1 database at 500 MB, which is the wall a growing video library hits
 * long before the 5 GB account allowance matters.
 */
export const storageBudget = {
  databaseLimitBytes: 500 * 1024 * 1024,
  /** Show the warning once this share of the database is in use. */
  warnAt: 0.8,
};

export const categories = [
  { id: 'baby-goats', label: 'Baby goats', blurb: 'Kids finding their legs' },
  { id: 'parkour', label: 'Goat parkour', blurb: 'Climbing, leaping, standing on things' },
  { id: 'farm-life', label: 'Farm life', blurb: 'Daily routines and barnyard characters' },
  { id: 'mountain-goats', label: 'Mountain goats', blurb: 'Wild herds, cliffs and altitude' },
  { id: 'goat-sounds', label: 'Goat sounds', blurb: 'Bleats, trills and other opinions' },
  { id: 'rescue-care', label: 'Rescue & care', blurb: 'Rehomed goats and good husbandry' },
];

export const categoryById = new Map(categories.map((c) => [c.id, c]));

/**
 * Starting weights for the interest model. Plain numbers on purpose: they can
 * be read, explained and tuned without a training pipeline.
 */
export const interactionWeights = {
  complete: 5,
  rewatch: 6,
  like: 3,
  comment: 2,
  follow: 4,
  skip: -4,
  notInterested: -15,
} as const;

export const feedMix = {
  personalized: 0.8,
  discovery: 0.15,
  trending: 0.05,
} as const;

export const postReportReasons = [
  'Not actually a goat',
  'Animal mistreatment',
  'Spam or misleading',
  'Harassment or hate',
  'Something else',
];

export const commentReportReasons = ['Spam', 'Harassment', 'Hate speech', 'Something else'];

export const rejectionReasons = [
  'Not goat-related',
  'Looks like animal mistreatment',
  'Poor photo or video quality',
  'Footage or photos belong to someone else',
  'Duplicate post',
  'Caption or tags need work',
  'Something else',
];

export const guidelines = [
  'Goats only. Goats with other animals are fine, as long as a goat is the point.',
  'Treat animals well. No distress, injury, baiting or unsafe handling.',
  'Post your own footage and photos, or credit the person who made them.',
  'No personal information about other people, and no harassment.',
  'Every post is looked at by a human before it goes live.',
];

/** Manual moderation is the default at every size. */
export const moderation = 'manual' as const;
