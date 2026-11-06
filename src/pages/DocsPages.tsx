import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/config';

function Doc({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <article className="column column--reading doc">
      <header className="page-head">
        <Link to="/" className="back-link">
          Back to the feed
        </Link>
        <h1 className="page-title">{title}</h1>
        <p className="page-blurb">{intro}</p>
      </header>
      <div className="doc__body">{children}</div>
      <footer className="doc__foot">
        <p>
          Questions go to the moderator through the report form or the contact address on the
          repository.
        </p>
      </footer>
    </article>
  );
}

export function GuidelinesPage() {
  const config = useConfig();
  return (
    <Doc
      title="Community guidelines"
      intro="Short version: goats, treated well, posted honestly. Everything here is enforced by a person reading each post."
    >
      <h2>The five rules</h2>
      <ol className="doc__list">
        {config.guidelines.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ol>

      <h2>What gets a post rejected</h2>
      <ul className="doc__list">
        <li>No goat in the photos, or a goat so incidental the post is really about something else.</li>
        <li>Handling that frightens or hurts the animal, including baiting for a reaction.</li>
        <li>Photos taken from another account or a stock site without credit.</li>
        <li>Captions that insult people, or that reveal someone’s address, workplace or school.</li>
        <li>Spam: the same post again, or a caption that is mostly links.</li>
      </ul>

      <h2>How review works</h2>
      <p>
        Uploads sit in a queue. The moderator opens each one, looks at every photo, listens to the
        audio if there is any, and approves or rejects it with a reason. Nothing is published
        automatically, and the queue does not change when the site grows past a thousand accounts —
        that is a decision for the owner, not a threshold.
      </p>

      <h2>Reports</h2>
      <p>
        Reporting a post or a comment sends it to the same queue. Reports are read by a human. If a
        post breaks the rules after it was approved, it is removed and the creator is told why.
      </p>

      <h2>Accounts</h2>
      <p>
        Accounts can be suspended for repeat uploads that break these rules, for harassment, or for
        using the site to sell things. A suspension hides the account’s posts from every feed.
      </p>
    </Doc>
  );
}

export function PrivacyPage() {
  return (
    <Doc
      title="Privacy"
      intro="What this deployment actually stores, and what it does not."
    >
      <h2>What is stored</h2>
      <ul className="doc__list">
        <li>Your email address, username, display name and a hashed password.</li>
        <li>Your bio and profile photo, if you add them.</li>
        <li>The photos, captions, categories and sounds you post.</li>
        <li>Interactions: views, likes, comments, follows, skips and “not interested”.</li>
        <li>Moderation notes and the reason a post was approved, rejected or removed.</li>
      </ul>

      <h2>What is not stored</h2>
      <ul className="doc__list">
        <li>No precise location. Photos are re-encoded in your browser before upload, which strips EXIF metadata including GPS.</li>
        <li>No advertising identifiers, and no third-party analytics scripts on this site.</li>
        <li>No private messages — this version has none.</li>
      </ul>

      <h2>Where it lives</h2>
      <p>
        The site is static files served by GitHub Pages. The API, database and media files run on
        Cloudflare Workers and D1. Authentication tokens are stored in your browser’s local storage;
        the site sets no advertising cookies.
      </p>

      <h2>Who can see what</h2>
      <p>
        Approved content is public. Pending and rejected posts, and their photos and audio, are
        visible only to the person who posted them and the moderator. Emails are never shown on
        public profiles.
      </p>

      <h2>Email</h2>
      <p>
        This deployment has no mail provider connected. Password reset links are shown on screen
        after you request one instead of being emailed. When a provider is added, that note will
        change.
      </p>

      <h2>Deleting your data</h2>
      <p>
        You can delete any of your posts from the post menu. To remove an account and everything
        attached to it, ask the moderator — there is no self-service account deletion in this
        version yet.
      </p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Terms of use" intro="The agreement, in plain language.">
      <h2>Your account</h2>
      <p>
        You need an account to post. Keep your password to yourself, and use an address you can
        actually receive mail at. One person, one account; do not impersonate other people or
        animals you do not own.
      </p>

      <h2>Your posts</h2>
      <p>
        You keep ownership of your photos and audio. By posting, you give GoatMedia permission to
        store and display them on this site. Only post work you have the right to share.
      </p>

      <h2>Moderation</h2>
      <p>
        Every post is reviewed by a human before it appears publicly. The moderator may approve,
        reject or later remove a post, and may suspend accounts that break the guidelines. There is
        no appeal queue in this version; ask directly and a person will answer.
      </p>

      <h2>Costs and availability</h2>
      <p>
        GoatMedia is free to use and runs on free-tier infrastructure. That means it can be slow,
        or briefly unavailable, and features may change. Do not rely on it as a backup for your
        photos.
      </p>

      <h2>Age</h2>
      <p>
        If you are under the age of majority where you live, only use GoatMedia with a parent or
        guardian involved, especially because public moderation and hosting accounts are managed by
        the site owner.
      </p>

      <h2>Animal welfare</h2>
      <p>
        Content that shows distress, injury or dangerous handling of animals is removed. That rule
        outranks anything else on this page.
      </p>
    </Doc>
  );
}
