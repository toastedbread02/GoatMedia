package app.goatmedia;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

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

    // Uploads: the site's <input type="file"> opens the system picker, which can
    // return several items. The URI array is handed back to the page as-is.
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(
          WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (pendingFiles != null) {
          pendingFiles.onReceiveValue(null);
        }
        pendingFiles = callback;

        Intent intent;
        try {
          intent = params.createIntent();
        } catch (Exception error) {
          intent = new Intent(Intent.ACTION_GET_CONTENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("*/*");
        }
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try {
          startActivityForResult(intent, FILE_CHOOSER);
        } catch (ActivityNotFoundException missing) {
          pendingFiles = null;
          return false;
        }
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
