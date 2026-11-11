import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ARG_CODE, ARG_LOGIN_USER } from '../lib/argDeep.ts';
import { useDocumentTitle } from '../lib/hooks.ts';

/**
 * The login the trail opens into. It is deliberately not the site: no shell, no
 * theme, no logo — the browser's own form controls on a white page, so it looks
 * like something that was left running rather than something that was designed.
 */
export function ArgSysLoginPage() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (username.trim() === ARG_LOGIN_USER && password === ARG_CODE) {
      navigate('/sys/blank');
      return;
    }
    setError(true);
  };

  return (
    <div className="arg-sys">
      <form onSubmit={submit} autoComplete="off">
        <p>
          <label htmlFor="arg-user">Username </label>
          <input
            id="arg-user"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="off"
            autoFocus
          />
        </p>
        <p>
          <label htmlFor="arg-pass">Password </label>
          <input
            id="arg-pass"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="off"
          />
        </p>
        <p>
          <button type="submit">Sign in</button>
        </p>
        {error ? <p className="arg-sys__error">Wrong username or password.</p> : null}
      </form>
    </div>
  );
}
