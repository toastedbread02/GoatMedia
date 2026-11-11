package app.goatmedia;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.util.Locale;

/**
 * The site in a WebView. Everything — feeds, the reel, uploads, the moderator
 * tools — is the same web app; this shell only supplies the window, the back
 * button, a file picker for uploads and a place for outside links to open.
 */
public class MainActivity extends Activity {
  private static final String HOME = "https://toastedbread02.github.io/GoatMedia/";
  private static final int FILE_CHOOSER = 1001;

  private WebView web;
  private ValueCallback<Uri[]> pendingFiles;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    web.setBackgroundColor(Color.parseColor("#F5F0E5"));

    WebSettings settings = web.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(true);
    settings.setSupportZoom(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(true);
    settings.setCacheMode(WebSettings.LOAD_DEFAULT);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String host = uri.getHost();
        if (host != null && (host.endsWith("github.io") || host.endsWith("workers.dev"))) {
          return false;
        }
        try {
          startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception ignored) {
          // No app for this link; staying put is better than crashing.
        }
        return true;
      }
    });

    // Uploads: the site's <input type="file"> asks the shell where the file comes
    // from. Recording happens in the camera app and comes back as its own URI, so
    // a clip never has to exist in storage first.
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(
          WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (pendingFiles != null) {
          pendingFiles.onReceiveValue(null);
        }
        pendingFiles = callback;

        Intent chosen;
        try {
          chosen = params.createIntent();
        } catch (Exception error) {
          chosen = new Intent(Intent.ACTION_GET_CONTENT);
          chosen.addCategory(Intent.CATEGORY_OPENABLE);
          chosen.setType("*/*");
        }
        final Intent picker = chosen;
        picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

        // A photo or audio field opens its own picker.
        if (!acceptsVideo(params)) {
          try {
            startActivityForResult(picker, FILE_CHOOSER);
          } catch (ActivityNotFoundException missing) {
            pendingFiles.onReceiveValue(null);
            pendingFiles = null;
          }
          return true;
        }

        final Intent record = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
        record.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);

        // Both choices are always offered. If the phone has no camera app, or the
        // camera refuses to start, the file browser opens instead of the upload
        // stalling on a chooser that never returns.
        final CharSequence[] options = new CharSequence[] { "Record a video", "Choose a file" };

        new AlertDialog.Builder(MainActivity.this)
            .setTitle("Add a video")
            .setItems(
                options,
                (dialog, which) -> {
                  try {
                    startActivityForResult(which == 0 ? record : picker, FILE_CHOOSER);
                  } catch (ActivityNotFoundException missing) {
                    if (which == 0) {
                      try {
                        startActivityForResult(picker, FILE_CHOOSER);
                        return;
                      } catch (ActivityNotFoundException alsoMissing) {
                        // Nothing on this phone handles either intent.
                      }
                    }
                    if (pendingFiles != null) {
                      pendingFiles.onReceiveValue(null);
                      pendingFiles = null;
                    }
                  }
                })
            .setOnCancelListener(
                dialog -> {
                  if (pendingFiles != null) {
                    pendingFiles.onReceiveValue(null);
                    pendingFiles = null;
                  }
                })
            .show();
        return true;
      }
    });

    setContentView(web);
    if (state != null) {
      web.restoreState(state);
    } else {
      web.loadUrl(HOME);
    }
  }

  // A field that names only images or audio has no use for the camera entry, so
  // it goes straight to the system picker. An unrestricted field still may.
  private static boolean acceptsVideo(WebChromeClient.FileChooserParams params) {
    String[] types = params.getAcceptTypes();
    if (types == null || types.length == 0) return true;
    for (String type : types) {
      if (type == null) continue;
      String value = type.trim().toLowerCase(Locale.ROOT);
      if (value.isEmpty() || value.equals("*/*") || value.startsWith("video/")) return true;
    }
    return false;
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != FILE_CHOOSER) {
      super.onActivityResult(requestCode, resultCode, data);
      return;
    }
    if (pendingFiles == null) return;

    Uri[] result = null;
    if (resultCode == RESULT_OK && data != null) {
      if (data.getClipData() != null) {
        int count = data.getClipData().getItemCount();
        result = new Uri[count];
        for (int index = 0; index < count; index += 1) {
          result[index] = data.getClipData().getItemAt(index).getUri();
        }
      } else if (data.getData() != null) {
        result = new Uri[] { data.getData() };
      }
    }
    pendingFiles.onReceiveValue(result);
    pendingFiles = null;
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) {
      web.goBack();
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    web.saveState(out);
  }
}
