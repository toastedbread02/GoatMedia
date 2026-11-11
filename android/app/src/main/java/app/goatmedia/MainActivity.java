package app.goatmedia;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;

import java.io.File;
import java.util.Locale;

/**
 * The site in a WebView. Everything — feeds, the reel, uploads, the moderator
 * tools — is the same web app; this shell only supplies the window, the back
 * button, a file picker for uploads and a place for outside links to open.
 */
public class MainActivity extends Activity {
  private static final String HOME = "https://toastedbread02.github.io/GoatMedia/";
  private static final int FILE_CHOOSER = 1001;
  private static final int PHOTO_CAPTURE = 1002;

  private static final int KIND_VIDEO = 1;
  private static final int KIND_IMAGE = 2;
  private static final int KIND_OTHER = 3;

  private WebView web;
  private ValueCallback<Uri[]> pendingFiles;
  private Uri pendingPhoto;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      // Only a debuggable build exposes the page to DevTools, so a sideloaded
      // release app stays closed to a connected computer.
      WebView.setWebContentsDebuggingEnabled(true);
    }
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
    // from. The dialog follows the field: a clip can be recorded, a photo can be
    // shot, anything else goes straight to the system picker.
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

        final int kind = mediaKind(params);
        if (kind == KIND_IMAGE) {
          askForPhoto(picker);
          return true;
        }
        if (kind != KIND_VIDEO) {
          openPicker(picker);
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
                    answerWithoutFile();
                  }
                })
            .setOnCancelListener(dialog -> answerWithoutFile())
            .show();
        return true;
      }
    });

    // Android 15 draws the window edge to edge, so the page has to be kept clear
    // of the status bar, the camera cutout and the navigation bar itself. Without
    // this the site's header sits under the clock and taps land in the
    // notification shade, and the bottom tab bar sits under the system buttons.
    if (Build.VERSION.SDK_INT >= 30) {
      getWindow().setDecorFitsSystemWindows(false);
    }
    FrameLayout frame = new FrameLayout(this);
    frame.setBackgroundColor(Color.parseColor("#F5F0E5"));
    frame.addView(
        web,
        new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    frame.setOnApplyWindowInsetsListener(
        (view, insets) -> {
          int left;
          int top;
          int right;
          int bottom;
          if (Build.VERSION.SDK_INT >= 30) {
            android.graphics.Insets bars =
                insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            left = bars.left;
            top = bars.top;
            right = bars.right;
            bottom = bars.bottom;
          } else {
            left = insets.getSystemWindowInsetLeft();
            top = insets.getSystemWindowInsetTop();
            right = insets.getSystemWindowInsetRight();
            bottom = insets.getSystemWindowInsetBottom();
          }
          if (view.getPaddingLeft() != left
              || view.getPaddingTop() != top
              || view.getPaddingRight() != right
              || view.getPaddingBottom() != bottom) {
            view.setPadding(left, top, right, bottom);
          }
          return insets;
        });
    setContentView(frame);
    frame.requestApplyInsets();

    if (state != null) {
      web.restoreState(state);
    } else {
      web.loadUrl(HOME);
    }
  }

  // A field names what it takes through its accept list. An unrestricted field
  // keeps the video flow, which still offers the system picker.
  private static int mediaKind(WebChromeClient.FileChooserParams params) {
    String[] types = params.getAcceptTypes();
    if (types == null || types.length == 0) return KIND_VIDEO;
    boolean video = false;
    boolean image = false;
    for (String type : types) {
      if (type == null) continue;
      String value = type.trim().toLowerCase(Locale.ROOT);
      if (value.isEmpty() || value.equals("*/*")) return KIND_VIDEO;
      if (value.startsWith("video/")) video = true;
      else if (value.startsWith("image/")) image = true;
    }
    if (video) return KIND_VIDEO;
    if (image) return KIND_IMAGE;
    return KIND_OTHER;
  }

  private void askForPhoto(Intent picker) {
    new AlertDialog.Builder(this)
        .setTitle("Add a photo")
        .setItems(
            new CharSequence[] { "Take a photo", "Choose a photo" },
            (dialog, which) -> {
              if (which == 0 && startPhotoCapture()) return;
              openPicker(picker);
            })
        .setOnCancelListener(dialog -> answerWithoutFile())
        .show();
  }

  // Without EXTRA_OUTPUT the camera only returns a thumbnail, so it writes full
  // size into a cache file of ours and hands that URI back instead.
  private boolean startPhotoCapture() {
    File dir = new File(getCacheDir(), "captures");
    if (!dir.isDirectory() && !dir.mkdirs()) return false;
    Uri output = UploadFiles.uriFor(this, new File(dir, "photo-" + System.currentTimeMillis() + ".jpg"));
    Intent capture = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
    capture.putExtra(MediaStore.EXTRA_OUTPUT, output);
    capture.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      pendingPhoto = output;
      startActivityForResult(capture, PHOTO_CAPTURE);
      return true;
    } catch (ActivityNotFoundException missing) {
      pendingPhoto = null;
      return false;
    }
  }

  private void openPicker(Intent picker) {
    try {
      startActivityForResult(picker, FILE_CHOOSER);
    } catch (ActivityNotFoundException missing) {
      answerWithoutFile();
    }
  }

  private void answerWithoutFile() {
    if (pendingFiles != null) {
      pendingFiles.onReceiveValue(null);
      pendingFiles = null;
    }
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode == PHOTO_CAPTURE) {
      Uri taken = null;
      if (resultCode == RESULT_OK && pendingPhoto != null) {
        File file = UploadFiles.fileFor(this, pendingPhoto);
        if (file.exists() && file.length() > 0) taken = pendingPhoto;
      }
      pendingPhoto = null;
      if (pendingFiles != null) {
        pendingFiles.onReceiveValue(taken == null ? null : new Uri[] { taken });
        pendingFiles = null;
      }
      return;
    }
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
