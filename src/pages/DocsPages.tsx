import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/hooks.ts';
import { Logo } from '../components/Logo.tsx';

/**
 * The operator block. Everything else in these documents reads from it, so the
 * wording cannot drift between pages. Fill in a trading name and a country
 * here if GoatMedia ever becomes a registered entity; until then the honest
 * description is the one below.
 */
const OPERATOR = {
  who: 'the individual who runs GoatMedia',
  country: 'the country where that person lives',
};

const LAST_UPDATED = '7 November 2026';

function DocLayout({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
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
        <p className="doc-meta">Last updated {LAST_UPDATED}</p>
        {lede ? <p className="doc-lede">{lede}</p> : null}
        <div className="prose">{children}</div>
      </main>
      <footer className="doc-foot">
        <Link to="/guidelines">Community guidelines</Link>
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/cookies">Cookies and storage</Link>
        <Link to="/copyright">Copyright</Link>
        <Link to="/about">About GoatMedia</Link>
        <Link to="/contact">Contact the moderator</Link>
      </footer>
    </div>
  );
}

export function GuidelinesPage() {
  useDocumentTitle('Community guidelines');
  return (
    <DocLayout
      title="Community guidelines"
      lede="GoatMedia exists for one narrow, happy thing: watching goats. These rules are short because the platform is small and a person looks at every post before it goes live."
    >
      <h2>What belongs here</h2>
      <ul>
        <li>Goats, goats with other animals, goats ignoring you, goats standing on things they should not.</li>
        <li>Footage and photos you made yourself, or that you have the right to share.</li>
        <li>Clips and pictures that show animals being handled calmly and safely.</li>
      </ul>
      <h2>What does not</h2>
      <ul>
        <li>Animal mistreatment, distress, baiting, injury or unsafe handling. This is an immediate rejection.</li>
        <li>Posts where a goat is not really the subject.</li>
        <li>Harassment, hate, spam, scams, or footage of other people without their consent.</li>
        <li>Personal information about anyone, including yourself.</li>
        <li>Advertising, referral links or political campaigning.</li>
      </ul>
      <h2>Review</h2>
      <p>
        Every post enters a manual queue. Nothing is published automatically, and no account can skip review. A
        moderator watches the clip or opens the photos, reads the caption and approves or rejects it. You can see the
        status of your uploads on your profile, and rejected posts include a reason.
      </p>
      <p>
        Approved posts can still be removed later if a report is upheld. Accounts that repeatedly break these rules can
        be suspended, which hides their posts and comments.
      </p>
      <h2>Comments</h2>
      <p>
        Be decent. Comments can be deleted by their author or a moderator, and reported by anyone. Keep links out of
        comments; they are not needed to talk about a goat.
      </p>
      <h2>Reporting</h2>
      <p>
        Use the report action on a post or comment. Reports go into the same moderation queue. Include context if it
        helps; the moderator sees your username but the person you reported does not.
      </p>
      <p>
        If the report action is not the right tool — a broken page, a hacked account, something urgent — use the{' '}
        <Link to="/contact">contact form</Link>.
      </p>
    </DocLayout>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  return (
    <DocLayout
      title="Privacy"
      lede="This page says exactly what GoatMedia stores, why it stores it, who else can see it and how to get rid of it. It is meant to be read, not to be skimmed past. If something here does not match what you observe on the site, tell the moderator and this page gets fixed."
    >
      <h2>Who is responsible</h2>
      <p>
        GoatMedia is run by {OPERATOR.who}. There is no company, no advertising team and no data team — the same person
        hosts the site, reviews the uploads and answers the <Link to="/contact">contact form</Link>. That person is the
        data controller for the information described below.
      </p>

      <h2>What we collect</h2>
      <h3>Account details</h3>
      <ul>
        <li>Your email address, used to sign in and to recover the account. It is not shown on your profile and is visible only to moderators.</li>
        <li>Your password, stored only as a one-way hash. Nobody, including the moderator, can read it.</li>
        <li>Your username, display name, avatar and bio — whatever you choose to put there.</li>
        <li>
          Your date of birth. It exists only to check that you meet the minimum age of 13 and to answer an account
          recovery request. It is never shown to anyone else, and the public site sees only a yes/no answer.
        </li>
        <li>Account state: when you signed up, whether the account is active or suspended, and any suspension reason.</li>
      </ul>
      <h3>What you post</h3>
      <ul>
        <li>Videos, photos, captions, categories and any audio you upload or borrow from another post.</li>
        <li>Comments, replies and likes on comments.</li>
        <li>Reports you file, and messages you send through the contact form.</li>
      </ul>
      <h3>What the automatic check sees</h3>
      <ul>
        <li>
          A few still images from an upload — the first photos of an album, or the poster frame and two frames sampled
          from later in a video — are sent to Cloudflare's Workers AI to answer one question: does this show graphic
          gore? Only the probability that comes
          back is stored, on the post, as a number. The images are not kept by that service for anything else and are
          not used to train a model.
        </li>
        <li>
          Warnings and appeals: the reason, whether a person or the filter raised it, what you wrote in an appeal, and
          the decision. These are moderation records, visible to moderators and to you.
        </li>
        <li>
          Whether a notice email was sent, failed or could not be sent, so that a missing email can be explained rather
          than guessed at.
        </li>
      </ul>

      <h3>What you do on the site</h3>
      <ul>
        <li>
          Which posts you were shown and which you opened, how much of a video you watched, whether you finished or
          rewatched it, and whether you swiped past it quickly.
        </li>
        <li>Likes, comments, saves, follows, blocks and “not interested” choices.</li>
        <li>Search terms, used to return results and nothing else.</li>
        <li>Your feed interests, which are derived from the activity above.</li>
      </ul>
      <h3>Technical records</h3>
      <ul>
        <li>
          A sign-in token. The token in your browser is stored in this site's local storage, and the server keeps only
          a hash of it, which expires 30 days after you sign in.
        </li>
        <li>
          A visit record when a page loads: an anonymous visitor key, the site that referred you (the referring host
          only, never the full address), the page you landed on and the time. The visitor key is a one-way hash of your
          IP address and browser string. The raw IP address and browser string are not stored in that record.
        </li>
        <li>
          A similar hashed key on posts watched while signed out, so a refresh does not inflate the view count.
        </li>
        <li>Your IP address is processed temporarily to apply rate limits, so one script cannot hammer the site.</li>
      </ul>

      <h2>What we do not collect</h2>
      <p>
        No precise location, no GPS or EXIF metadata (it is stripped from uploads), no address book or contacts, no
        advertising identifier, no cross-site browsing history, no fingerprinting beyond the single hash described
        above, and no email open or click tracking. There are no third-party analytics scripts, no advertising
        networks, no session-recording tools and no social login buttons that quietly report back. GoatMedia has no
        data to sell, and does not sell it.
      </p>

      <h2>Cookies and local storage</h2>
      <p>
        GoatMedia sets no cookies of its own. A few preferences and your sign-in token live in your browser's local
        storage, which is never sent anywhere except back to this site. The full list, and how to clear it, is on the{' '}
        <Link to="/cookies">cookies and storage</Link> page.
      </p>

      <h2>What other people can see</h2>
      <p>
        Your username, display name, avatar, bio, follower and following counts, and your approved posts with their
        captions, likes, comments and view counts are public. Your email address, date of birth, unapproved or removed
        posts, watch history, feed interests, reports you filed and moderation records are not public.
      </p>
      <p>
        In settings you can keep your follower and following lists private, and hide yourself from people search. The
        counts stay visible; the lists do not. If you make your lists private, only you can see who they are.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>Cloudflare</strong> hosts the API, the database and the stored media, and terminates TLS. Requests to
          the site therefore pass through their network, and their own security logs apply to them. Their Workers AI
          service answers the single gore question described above.
        </li>
        <li>
          <strong>GitHub</strong> serves the static site files through GitHub Pages, so a visit to goatmedia begins with
          a request to GitHub's servers.
        </li>
        <li>
          <strong>An email provider</strong> (Mailjet, Brevo or SendGrid, depending on which is configured) delivers moderation
          notices: warnings, suspensions, appeal decisions. It receives your email address and the contents of that
          message. Nothing else is sent through it. There is no newsletter and no marketing email.
        </li>
      </ul>
      <p>
        These are processors acting on instruction; none is given your data to use for their own marketing. There is no
        payment processor, because nothing on GoatMedia is for sale.
      </p>

      <h2>Where it is processed</h2>
      <p>
        Both providers run a global network, so your data may be stored or handled outside your country, including in
        the United States. Where that happens it is covered by those providers' standard contractual terms for
        international transfers.
      </p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Account details and posts: until you delete them or ask for the account to be closed.</li>
        <li>Sign-in tokens: 30 days after signing in, or immediately when you sign out.</li>
        <li>Visit records: deleted after 120 days. Your view history for the recommendation system is kept until you reset your interests or close the account.</li>
        <li>Reports and contact messages: kept while open, then retained as moderation history so a repeated problem is recognisable.</li>
        <li>Moderation decisions on your posts: kept with the post, and kept briefly after a removal so an appeal can be answered.</li>
        <li>Warnings: kept while they still count against the account, and kept on record if an appeal is declined. An accepted appeal removes one from the count.</li>
        <li>
          Appeal links: the hashed token stays until the appeal is decided. The email log entry (address, subject,
          delivery status) is kept so a missing notice can be investigated.
        </li>
      </ul>

      <h2>Your choices and rights</h2>
      <p>
        You can change your profile, avatar, bio, visibility settings and feed interests at any time in settings, and
        reset the interest model completely. To see a copy of what is stored about you, to correct something you cannot
        edit yourself, to delete your account, or to object to a particular use, use the{' '}
        <Link to="/contact">contact form</Link> and choose account recovery or something else. Requests are answered
        within 30 days, and asking costs nothing.
      </p>
      <p>
        If you are in the EEA or the UK, you also have the right to data portability and the right to complain to your
        national data protection authority. If you are in California, you have the right to know what is collected, to
        have it deleted, and to not be discriminated against for asking; GoatMedia does not sell or share personal
        information for advertising, so there is nothing to opt out of there.
      </p>

      <h2>Automatic checks and your right to a person</h2>
      <p>
        The gore filter is a pre-filter. It can be wrong — a goat in a red barn, a cut on a leg that healed months ago —
        so anything it flags is rejected rather than deleted, and a moderator can publish it after watching it. Every
        warning it produces can be appealed, and an appeal is read by a person, never by the filter again. No account is
        suspended by software without a written reason being emailed to it and an appeal route being available.
      </p>

      <h2>Closing an account</h2>
      <p>
        Account closure is handled by a moderator rather than a button, because a mistaken click would take your posts
        with it and there is no undo. Once closed, your profile, posts, media, comments, likes, follows and interest
        data are deleted, and your email address is released so it can be used again. Two things outlive closure:
        aggregate counts such as a view total that already includes your visit, and moderation records needed to keep a
        suspended person from returning under the same account.
      </p>

      <h2>Children</h2>
      <p>
        GoatMedia is not for anyone under 13, and an account cannot be created with a birth date that says otherwise.
        If you believe a child under 13 has an account, use the contact form and it will be removed. In countries where
        the age of digital consent is higher than 13, a parent or guardian should decide whether the account is
        appropriate.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is encrypted with TLS. Passwords are hashed, sign-in tokens are stored as hashes, and unapproved media
        is served only to its creator and to moderators, never through a public link. Administrative actions are
        checked on the server, not by hiding buttons. No system is perfect, and this one is run by one person on a small
        budget; if you find a weakness, report it through the contact form instead of testing it against other people's
        accounts.
      </p>

      <h2>Changes to this page</h2>
      <p>
        When what is collected changes, this page changes with it and the date at the top moves. Material changes are
        announced in the app so they are not buried here.
      </p>

      <h2>Complaints</h2>
      <p>
        Start with the <Link to="/contact">contact form</Link> — it reaches a person, not a ticket robot. If the answer
        does not resolve a data protection concern, you can escalate to the supervisory authority in your country.
      </p>
    </DocLayout>
  );
}

export function CookiesPage() {
  useDocumentTitle('Cookies and storage');
  return (
    <DocLayout
      title="Cookies and site storage"
      lede="GoatMedia sets no cookies of its own and runs no trackers. This page lists everything the site does keep in your browser, so the claim is checkable."
    >
      <h2>Cookies</h2>
      <p>
        None are set by GoatMedia's own code. Your sign-in is a token in local storage rather than a cookie, which is
        why there is no cookie banner to dismiss. Cloudflare, which serves the API, may set a short-lived security
        cookie on its own requests to tell a browser apart from a bot; that cookie is set by them, is not read by
        GoatMedia's code, and expires within half an hour.
      </p>

      <h2>What is stored in your browser</h2>
      <ul>
        <li>
          <strong>Sign-in token</strong> — keeps you signed in between visits. Removed when you sign out. Anyone with
          access to this browser profile could use it, which is the usual reason to sign out on a shared computer.
        </li>
        <li>
          <strong>Volume and mute</strong> — remembers how loud you wanted videos, so every clip does not start at the
          same default.
        </li>
        <li>
          <strong>Theme</strong> — whether you chose light, dark or to follow your system.
        </li>
        <li>
          <strong>Motion</strong> — whether you asked for reduced animation.
        </li>
        <li>
          <strong>Dismissed prompts</strong> — a flag so a suggestion you closed does not reappear on the next visit.
        </li>
      </ul>
      <p>
        All of it is local to your browser. None of it is shared with other sites, and none of it is used for
        advertising.
      </p>

      <h2>Clearing it</h2>
      <p>
        Clearing site data in your browser removes all of the above, including the sign-in token, so you will need to
        sign in again. You can also remove individual choices in settings — changing the theme or motion setting
        rewrites it there, and “reset interests” clears what the feed has learned.
      </p>

      <h2>If you block storage</h2>
      <p>
        The site still loads and you can still watch, but you will be signed out on each visit, and preferences such as
        volume and theme will reset. Private windows behave the same way, for the same reason.
      </p>

      <h2>Server-side counting is not storage</h2>
      <p>
        The traffic chart in the moderator dashboard counts arrivals, not people. Signed-out views are collapsed with a
        one-way hash of the network address and browser string, kept for at most 120 days, and the <Link to="/privacy">privacy page</Link>{' '}
        describes exactly what that record contains.
      </p>
    </DocLayout>
  );
}

export function CopyrightPage() {
  useDocumentTitle('Copyright');
  return (
    <DocLayout
      title="Copyright and takedowns"
      lede="People upload their own footage here, and occasionally someone uploads footage that belongs to someone else. This page explains how a takedown works from both sides."
    >
      <h2>Who owns what</h2>
      <p>
        You own the videos and photos you upload. GoatMedia owns the name, the logo, the design and the code. Uploading
        a post gives GoatMedia permission to host, resize, transcode and display it on the platform — nothing more, and
        not for sale.
      </p>

      <h2>If your work was posted without permission</h2>
      <p>
        Use the <Link to="/contact">contact form</Link> and pick “Report a problem”, or use the report action on the
        post itself. A useful notice includes:
      </p>
      <ul>
        <li>The post address (the link in your browser when the post is open) or the username of the uploader.</li>
        <li>What the work is, and where the original can be seen.</li>
        <li>Why you believe the upload is not authorised — for example, that you filmed it.</li>
        <li>How to reach you, so the decision can be explained.</li>
        <li>A statement that the information is accurate and that you are the rights holder or authorised to act for them.</li>
      </ul>
      <p>
        Incomplete notices still get looked at, but a notice that identifies the exact post is resolved much faster.
        Because every post is reviewed by a person anyway, action usually means removal from the feed while the two
        people are put in touch.
      </p>

      <h2>If your post was removed</h2>
      <p>
        You will be told, with the reason. If you have permission from the rights holder, or you are the rights holder,
        reply through the contact form with that explanation and the post can be restored. Repeatedly uploading other
        people's work is treated as a pattern, and can end in a suspension.
      </p>

      <h2>What counts as fair use</h2>
      <p>
        Short quotation, commentary, criticism and news reporting are treated leniently where the law allows it, but
        GoatMedia is small and cannot give legal advice. If a clip is mostly someone else's video with a small addition,
        expect it to be rejected as not your footage.
      </p>

      <h2>Sample clips</h2>
      <p>
        Some clearly labelled early clips come from Wikimedia Commons under Creative Commons licences, credited on the
        post itself. Those credits are part of the licence and are left in place.
      </p>

      <h2>False claims</h2>
      <p>
        A takedown is a serious request. Sending one to remove criticism, or to remove a video you simply dislike, is
        not allowed and can lead to your own account being restricted. If two people claim the same clip, the post stays
        offline until it is sorted out.
      </p>
    </DocLayout>
  );
}

export function TermsPage() {
  useDocumentTitle('Terms');
  return (
    <DocLayout
      title="Terms of use"
      lede="These terms are the agreement between you and GoatMedia. They are written plainly because a document nobody reads protects nobody. The short version: post goats, be decent, expect a human to review what you upload, and understand that this is a small free service with no guarantees."
    >
      <h2>Accepting these terms</h2>
      <p>
        By creating an account, browsing or uploading, you agree to these terms and to the{' '}
        <Link to="/guidelines">community guidelines</Link> and <Link to="/privacy">privacy page</Link>, which form part
        of them. If you do not agree, do not use the site.
      </p>

      <h2>Who may use GoatMedia</h2>
      <ul>
        <li>You must be at least 13 years old. If you are under the age of majority where you live, a parent or guardian must agree to these terms for you.</li>
        <li>You must be allowed to use an online service like this under the laws that apply to you, and not be barred from doing so by sanctions.</li>
        <li>One person, one account. Creating extra accounts to get around a suspension, a rate limit or a moderation decision breaks these terms.</li>
      </ul>

      <h2>Your account</h2>
      <p>
        Give accurate sign-up details, keep your password to yourself, and accept that what happens under your account is
        your responsibility. Choose a username you have the right to use; impersonating a person, a brand or a moderator
        is not allowed. If you think someone else has access to your account, change your password and use the{' '}
        <Link to="/contact">contact form</Link> so sessions can be cleared.
      </p>
      <p>
        Accounts cannot be transferred or sold. You can stop using GoatMedia at any time, and can ask for the account to
        be closed.
      </p>

      <h2>Your content</h2>
      <p>
        You keep ownership of everything you upload. To run the site, you give GoatMedia a non-exclusive, worldwide,
        royalty-free licence to store, copy, transcode, resize, thumbnail and display your posts on the platform, and to
        show them to moderators for review. That licence lasts while your post is on the platform and ends when you
        delete it, except for copies that survive briefly in backups and records kept for moderation.
      </p>
      <p>
        By uploading, you confirm that you made the footage and photos, or have permission to post them, and that
        publishing them does not break anyone else's rights or the law. You also agree not to assert moral rights
        against the ordinary technical things the platform does — compressing a video, cropping a thumbnail, showing a
        poster frame — while keeping your authorship credit on the post.
      </p>
      <p>
        Moderation is not publication. Approving a post does not make GoatMedia the publisher of it, and does not mean
        the platform endorses it.
      </p>
      <p>
        If you send a suggestion or bug report, GoatMedia may use it without owing you anything for it.
      </p>

      <h2>What you may not post</h2>
      <ul>
        <li>Anything that is not about a goat, or that uses a goat as a prop for something unrelated.</li>
        <li>Animal mistreatment: distress, injury, baiting, drugging or unsafe handling. This is a zero-tolerance removal.</li>
        <li>
          Graphic gore: open wounds, pooled blood, exposed tissue, butchery or a dead animal. A healed scar or a bit of
          mud is not gore, and the automatic filter is tuned to tell the difference — but it is not perfect, which is
          why every flag can be appealed.
        </li>
        <li>Sexual content, or any sexualised depiction of a minor. Reported to the relevant authority where required.</li>
        <li>Illegal content, threats, harassment, hate speech, or revealing someone else's personal information.</li>
        <li>Spam, scams, advertising, referral links, political campaigning, or repetitive uploads of the same clip.</li>
        <li>Other people's footage or photos without permission, or content you do not have the rights to license.</li>
        <li>Malware, or files crafted to break a browser or a player.</li>
      </ul>

      <h2>Moderation</h2>
      <p>
        Every post is watched or opened by a person before it becomes public. There is no automatic approval, and no
        account can skip the queue. A moderator may approve, reject with a reason, or remove an already published post.
        The moderator is not obliged to publish anything, and may decline a post that is technically allowed but does not
        fit the platform.
      </p>
      <p>
        If a post is rejected or removed, you can ask why through the contact form. Decisions are made by a person, and a
        clear explanation from you can change the outcome.
      </p>

      <h2>Automatic screening</h2>
      <p>
        Every upload is screened before it reaches the review queue. The check asks a vision model one question: does
        this image show graphic gore? A high enough probability sends the post to the rejected pile instead of the
        queue, and the score is written next to the post so a moderator can see exactly why. Nothing is deleted, and a
        moderator can publish a flagged post after watching it.
      </p>
      <p>
        The filter is a pre-filter, not a verdict. It will occasionally flag a goat in a red barn, and it will miss
        things. It is not a substitute for the human review that stands behind it, and no post is removed permanently
        because software said so.
      </p>

      <h2>Warnings, suspensions and appeals</h2>
      <ul>
        <li>
          A first and second violation of these terms — most often an upload the filter flagged as gore, including
          repeated attempts to get one past it — produce a written warning. The warning is emailed to the address on the
          account with the reason and an appeal link.
        </li>
        <li>
          A third active warning suspends the account. A moderator can also suspend directly for something serious, such
          as animal mistreatment or harassment. A suspension always carries a written reason, and that reason is
          emailed to the account.
        </li>
        <li>
          A suspended account cannot sign in to post, like or comment, and its posts and comments are hidden. The reason
          is shown when you try to use the account.
        </li>
        <li>
          Every warning and every suspension can be appealed once, using the link in the email. A person reads it and
          decides; the filter is never asked again. If an appeal is accepted, the warning stops counting, or the account
          is restored together with the posts that were hidden with it.
        </li>
        <li>
          If the notice email never arrives, the contact form reaches a moderator, and the reason is still visible when
          you try to sign in.
        </li>
      </ul>

      <h2>Using the service properly</h2>
      <p>
        Do not scrape or bulk-download the site, automate uploads or interactions, get around rate limits, probe for
        security holes on other people's accounts, resell access, mirror the service, or interfere with other people
        watching. Do not use GoatMedia to build a dataset or train a model on other people's footage. Reading the public
        site with a normal browser, and sharing links, is exactly what it is for.
      </p>

      <h2>Copyright</h2>
      <p>
        The name, logo, design and code belong to GoatMedia. Takedowns and counter-notices are handled as described on the{' '}
        <Link to="/copyright">copyright page</Link>.
      </p>

      <h2>Other services</h2>
      <p>
        The site is delivered through Cloudflare and GitHub Pages, and relies on your browser to decode video. Those
        providers have their own terms, and GoatMedia does not control their availability. Links to other websites are
        there because someone posted or needed them; GoatMedia is not responsible for what those sites do.
      </p>

      <h2>Availability and changes</h2>
      <p>
        GoatMedia is free, independent and run by one person. It may change, break, pause or stop, and features may be
        added or removed without notice. Storage is finite: nothing here is a backup, so keep your own copy of anything
        you would be upset to lose. There is no uptime commitment and no guarantee that a post stays online.
      </p>
      <p>
        GoatMedia may suspend or close an account that breaks these terms, evades moderation, or puts other people at
        risk. Where it is reasonable, you will be told why.
      </p>

      <h2>The service is provided as is</h2>
      <p>
        GoatMedia is provided “as is” and “as available”, without warranties of any kind, whether express or implied,
        including any implied warranty of merchantability, fitness for a particular purpose, accuracy or
        non-infringement. No advice or information from the site creates a warranty. Content is posted by users, is
        reviewed by a person doing their best, and may still be inaccurate, offensive or broken; GoatMedia does not
        guarantee that any post is what it claims to be, that playback will work on every device, or that the service
        will be uninterrupted or free of errors.
      </p>
      <p>
        Nothing in these terms excludes a warranty or right that the law does not allow to be excluded, including your
        statutory rights as a consumer.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        To the fullest extent the law allows, GoatMedia is not liable for indirect, incidental, special, consequential
        or punitive damages, or for lost data, lost footage, lost profits, lost reputation or lost followers, arising
        from your use of the site or your inability to use it.
      </p>
      <p>
        Where liability cannot be excluded, it is limited to the greater of the amount you paid GoatMedia in the twelve
        months before the claim — currently nothing, since the service is free — and twenty US dollars.
      </p>
      <p>
        Nothing here limits liability for death or personal injury caused by negligence, for fraud or deliberate
        misconduct, or for anything else that cannot lawfully be limited. If you are a consumer, you keep every right
        your local law gives you.
      </p>

      <h2>Indemnity</h2>
      <p>
        If a third party brings a claim against GoatMedia because of something you posted, or because you broke these
        terms, you agree to cover the reasonable costs of dealing with it. This does not apply to the extent the claim
        was caused by GoatMedia's own conduct.
      </p>

      <h2>Governing law and disputes</h2>
      <p>
        These terms are governed by the laws of {OPERATOR.country}, and its courts can hear disputes — without taking
        away your right, as a consumer, to bring a claim in the courts of the country where you live. Before anything
        formal, send a message through the contact form: nearly every problem on a site this size is solved by a
        conversation.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        These terms will change as the platform changes. The date at the top of the page moves when they do, and material
        changes are announced in the app. Continuing to use GoatMedia after a change means you accept the new version; if
        you do not, stop using the site and ask for the account to be closed.
      </p>

      <h2>General</h2>
      <p>
        If one part of these terms turns out to be unenforceable, the rest stays in force. Not enforcing a term once does
        not waive it. You may not transfer your rights under these terms; GoatMedia may transfer its own if the site
        changes hands, and will say so if it does. These terms, together with the guidelines, the privacy page, the
        cookies page and the copyright page, are the whole agreement between you and GoatMedia.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms, appeals and legal notices all go through the{' '}
        <Link to="/contact">contact form</Link>, which reaches a moderator and creates a record so nothing is lost.
      </p>
    </DocLayout>
  );
}

export function AboutPage() {
  useDocumentTitle('About');
  return (
    <DocLayout
      title="About GoatMedia"
      lede="A video community with a deliberately narrow subject: goats. No livestreams, no direct messages, no algorithmic volume. Just clips and photos of goats, submitted by people and approved by a person."
    >
      <h2>Why manual review</h2>
      <p>
        Every single upload is watched before it becomes public. This is intentionally inefficient. Manual review stays
        the default while the community is small, and it will not switch to automatic approval just because the site
        reaches a particular number of accounts. Any future change to that policy will be an explicit decision,
        announced here.
      </p>
      <h2>How the feed works</h2>
      <p>
        The For You feed is a transparent scoring system, not a trained model. It combines what you have watched,
        finished, rewatched, liked, commented on, saved and followed with freshness and recent popularity, while avoiding
        creators you see too often and posts you have already watched. You can inspect what it has learned in settings and
        reset it at any time.
      </p>
      <h2>Development sample data</h2>
      <p>
        This installation may include clearly labelled sample clips from Wikimedia Commons, used under their Creative
        Commons licences and credited on each post. They exist so the feed and moderation queue can be tried with real
        footage. Real uploads replace them; they are not real community activity.
      </p>
      <h2>The paperwork</h2>
      <p>
        The <Link to="/guidelines">community guidelines</Link> say what belongs here, the{' '}
        <Link to="/privacy">privacy page</Link> says what is stored, the <Link to="/terms">terms</Link> are the
        agreement, and <Link to="/cookies">cookies and storage</Link> lists everything kept in your browser.
      </p>
      <h2>Running it</h2>
      <p>
        GoatMedia is a small self-hosted application. The operator is responsible for hosting, backups, moderation and
        the legal requirements that apply where it is run.
      </p>
    </DocLayout>
  );
}
