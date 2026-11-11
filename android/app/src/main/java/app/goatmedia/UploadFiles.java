package app.goatmedia;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * Hands the camera app one file in our cache to write a photo into. A plain
 * file:// path is refused on modern Android, so the shot travels as a content
 * URI and comes back to the page as a normal image upload.
 */
public class UploadFiles extends ContentProvider {
  static Uri uriFor(Context context, File file) {
    return new Uri.Builder()
        .scheme("content")
        .authority(context.getPackageName() + ".captures")
        .appendPath(file.getName())
        .build();
  }

  static File fileFor(Context context, Uri uri) {
    return new File(new File(context.getCacheDir(), "captures"), uri.getLastPathSegment());
  }

  @Override
  public boolean onCreate() {
    return true;
  }

  @Override
  public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
    File file = fileFor(getContext(), uri);
    MatrixCursor cursor =
        new MatrixCursor(new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE });
    cursor.addRow(new Object[] { file.getName(), file.length() });
    return cursor;
  }

  @Override
  public String getType(Uri uri) {
    return "image/jpeg";
  }

  @Override
  public Uri insert(Uri uri, ContentValues values) {
    throw new UnsupportedOperationException("read only");
  }

  @Override
  public int delete(Uri uri, String selection, String[] args) {
    return 0;
  }

  @Override
  public int update(Uri uri, ContentValues values, String selection, String[] args) {
    return 0;
  }

  @Override
  public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
    File file = fileFor(getContext(), uri);
    File dir = file.getParentFile();
    if (dir != null && !dir.isDirectory()) dir.mkdirs();
    int flags =
        "r".equals(mode)
            ? ParcelFileDescriptor.MODE_READ_ONLY
            : ParcelFileDescriptor.MODE_WRITE_ONLY
                | ParcelFileDescriptor.MODE_CREATE
                | ParcelFileDescriptor.MODE_TRUNCATE;
    return ParcelFileDescriptor.open(file, flags);
  }
}
