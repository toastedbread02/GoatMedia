import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Logo } from '../components/Logo.tsx';

function DocLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="doc-page">
      <header className="doc-top">
        <Logo />
        <Link className="btn btn--quiet btn--sm" to="/">
          Back to the feed
        </Link>
      </header>
      <main className="doc-main">
        <h1 className="page-title">{title}</h1>
        <div className="prose">{children}</div>
      </main>
      <footer className="doc-foot">
        <Link to="/guidelines">Community guidelines</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/about">About GoatMedia</Link>
      </footer>
    </div>
  );
}

export function GuidelinesPage() {
  useDocumentTitle('Community guidelines');
  return (
    <DocLayout title="Community guidelines">
      <p>
        GoatMedia exists for one narrow, happy thing: watching goats. These rules are short because the platform is
        small and every upload is reviewed by a person.
      </p>
      <h2>What belongs here</h2>
      <ul>
        <li>Goats, goats with other animals, goats ignoring you, goats standing on things they should not.</li>
        <li>Footage you filmed yourself, or footage you have the right to share.</li>
        <li>Clips that show animals being handled calmly and safely.</li>
      </ul>
      <h2>What does not</h2>
      <ul>
        <li>Animal mistreatment, distress, baiting, injury or unsafe handling. This is an immediate rejection.</li>
        <li>Content where a goat is not really the subject.</li>
        <li>Harassment, hate, spam, scams or footage of other people without their consent.</li>
        <li>Personal information about anyone, including yourself.</li>
        <li>Advertising, referral links or political campaigning.</li>
      </ul>
      <h2>Review</h2>
      <p>
        Every video enters a manual queue. Nothing is published automatically, and no account can skip review. The
        moderator watches the clip, reads the caption and approves or rejects it. You can see the status of your
        uploads on your profile, and rejected videos include a reason.
      </p>
      <p>
        Approved videos can still be removed later if a report is upheld. Accounts that repeatedly break these rules
        can be suspended, which hides their videos and comments.
      </p>
      <h2>Comments</h2>
      <p>
        Be decent. Comments can be deleted by their author or the moderator, and reported by anyone signed in. Keep
        links out of comments; they are not needed to talk about a goat.
      </p>
      <h2>Reporting</h2>
      <p>
        Use the report action on a video or comment. Reports go into the same moderation queue. Include context if it
        helps; the moderator sees your username but the reported person does not.
      </p>
    </DocLayout>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  return (
    <DocLayout title="Privacy">
      <p>
        GoatMedia collects as little as it can while still working as an account-based video site. This page explains
        exactly what is stored and who can see it.
      </p>
      <h2>What we store</h2>
      <ul>
        <li>Your email address, username, display name and password hash. Passwords are never stored in plain text.</li>
        <li>Your bio, profile photo and the videos and captions you upload.</li>
        <li>Which videos you watched, how long for, and the likes, comments and follows you make. This powers your feed.</li>
        <li>A session cookie so you stay signed in. It is HTTP-only and cannot be read by page scripts.</li>
        <li>
          An anonymous viewer cookie, if you watch without an account, so a refresh does not count as a new view. It
          contains a random number, not a profile.
        </li>
      </ul>
      <h2>What is public</h2>
      <p>
        Your username, display name, bio, photo, approved videos and follower counts are public. Your email address,
        hidden videos, watch history and moderation reasons are not shown on your profile. Email addresses are visible
        only to the moderator, for account support.
      </p>
      <h2>Location metadata</h2>
      <p>
        Uploaded videos are re-processed on the server, which removes embedded metadata including location tags. The
        original file is not kept.
      </p>
      <h2>Pending and rejected uploads</h2>
      <p>
        Unapproved videos are stored privately and served only to their creator and the moderator. They are excluded
        from search, feeds and share pages.
      </p>
      <h2>Retention and control</h2>
      <p>
        You can delete a comment, remove one of your videos and reset the interests the feed has learned. Blocking an
        account hides its content from you. To close an account, contact the moderator account that runs this
        installation.
      </p>
      <h2>Services</h2>
      <p>
        This installation stores its database and media on the server that runs it. It does not load third-party
        analytics, advertising or tracking scripts.
      </p>
    </DocLayout>
  );
}

export function TermsPage() {
  useDocumentTitle('Terms');
  return (
    <DocLayout title="Terms of use">
      <p>
        By using GoatMedia you agree to these terms and the community guidelines. If you do not agree, do not use the
        site.
      </p>
      <h2>Your account</h2>
      <p>
        You are responsible for what happens under your account and for keeping your password private. You must be old
        enough to consent to using an online service in your country. One person, one account.
      </p>
      <h2>Your uploads</h2>
      <p>
        You keep ownership of the videos you upload. You give GoatMedia permission to store, process and display them
        on the platform, including thumbnail generation and moderation review. Only upload footage you have the right
        to share.
      </p>
      <h2>Moderation</h2>
      <p>
        Every upload is reviewed manually before publication. The moderator may reject, remove or leave a video
        unpublished, and may suspend accounts that break the rules. Moderation decisions are made by a person and can
        be appealed by contacting the moderator.
      </p>
      <h2>Availability</h2>
      <p>
        This is an independent project. The service is provided as-is, without guarantees of uptime or permanent
        storage. Do not use it as your only copy of a video.
      </p>
      <h2>Changes</h2>
      <p>
        These terms may change as the platform grows. Significant changes will be noted on the About page.
      </p>
    </DocLayout>
  );
}

export function AboutPage() {
  useDocumentTitle('About');
  return (
    <DocLayout title="About GoatMedia">
      <p>
        GoatMedia is a video community with a deliberately narrow subject: goats. No livestreams, no direct messages,
        no algorithmic volume. Just clips of goats, submitted by people and approved by a person.
      </p>
      <h2>Why manual review</h2>
      <p>
        Every single upload is watched before it becomes public. This is intentionally inefficient. Manual review
        stays the default while the community is small, and it will not switch to automatic approval just because the
        site reaches a particular number of accounts. Any future change to that policy will be an explicit decision,
        announced here.
      </p>
      <h2>How the feed works</h2>
      <p>
        The For You feed is a transparent scoring system, not a trained model. It combines what you have watched,
        finished, rewatched, liked, commented on and followed with freshness and recent popularity, while avoiding
        creators you see too often and videos you have already watched. You can inspect what it has learned in
        settings and reset it at any time.
      </p>
      <h2>Development sample data</h2>
      <p>
        This installation may include clearly labelled sample clips from Wikimedia Commons, used under their Creative
        Commons licences and credited on each video. They exist so the feed and moderation queue can be tried with
        real footage. Real uploads replace them; they are not real community activity.
      </p>
      <h2>Running it</h2>
      <p>
        GoatMedia is a small self-hosted application. The operator is responsible for hosting, backups, moderation and
        the legal requirements that apply where it is run.
      </p>
    </DocLayout>
  );
}
