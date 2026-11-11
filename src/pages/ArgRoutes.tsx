import { useParams } from 'react-router-dom';
import { VideoPage } from './VideoPage.tsx';
import { ProfilePage } from './ProfilePage.tsx';
import { ArgPostPage } from './ArgPostPage.tsx';
import { ArgProfilePage } from './ArgProfilePage.tsx';
import { argPost, argProfile } from '../lib/easterEgg.ts';

/**
 * Both routes first ask the trail whether it knows the path. If it does, the
 * page is built from the browser; if not, the request goes to the API exactly
 * as it always did, so an unknown id still answers with the ordinary 404.
 */
export function VideoRoute() {
  const { id } = useParams();
  if (argPost(id)) return <ArgPostPage id={id as string} />;
  return <VideoPage />;
}

export function ProfileRoute() {
  const { username } = useParams();
  if (argProfile(username)) return <ArgProfilePage username={username as string} />;
  return <ProfilePage />;
}
