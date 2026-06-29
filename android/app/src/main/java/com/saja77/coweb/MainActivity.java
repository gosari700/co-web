package com.saja77.coweb;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
  private static final String APP_URL = "https://co-web-umber.vercel.app/";
  private static final int CAMERA_PERMISSION_REQUEST = 77;

  private WebView webView;
  private PermissionRequest pendingPermissionRequest;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureWindow();
    configureWebView();
    webView.loadUrl(APP_URL);
  }

  private void configureWindow() {
    Window window = getWindow();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false);
    }
    window.getDecorView().setBackgroundColor(Color.WHITE);
    window.setStatusBarColor(Color.WHITE);
    window.setNavigationBarColor(Color.WHITE);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.setStatusBarContrastEnforced(false);
      window.setNavigationBarContrastEnforced(false);
    }
    setLightSystemBars(window);
  }

  private void setLightSystemBars(Window window) {
    int flags = window.getDecorView().getSystemUiVisibility();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
    }
    window.getDecorView().setSystemUiVisibility(flags);

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      return;
    }

    WindowInsetsController controller = window.getInsetsController();
    if (controller == null) {
      return;
    }
    int appearance = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
      | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
    controller.setSystemBarsAppearance(appearance, appearance);
  }

  private void configureWebView() {
    FrameLayout container = createSystemBarContainer();
    webView = new WebView(this);
    webView.setBackgroundColor(Color.BLACK);
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
    container.addView(webView, new FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT
    ));
    setContentView(container);
    container.requestApplyInsets();

    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setLoadWithOverviewMode(false);
    settings.setUseWideViewPort(false);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    }

    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return shouldKeepInWebView(request.getUrl());
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return shouldKeepInWebView(Uri.parse(url));
      }
    });

    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(PermissionRequest request) {
        handlePermissionRequest(request);
      }
    });
  }

  private FrameLayout createSystemBarContainer() {
    FrameLayout container = new FrameLayout(this);
    container.setBackgroundColor(Color.WHITE);
    container.setOnApplyWindowInsetsListener((view, insets) -> {
      int topInset = insets.getSystemWindowInsetTop();
      int bottomInset = insets.getSystemWindowInsetBottom();
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        android.graphics.Insets systemBars = insets.getInsets(WindowInsets.Type.systemBars());
        topInset = systemBars.top;
        bottomInset = systemBars.bottom;
      }
      view.setPadding(0, topInset, 0, bottomInset);
      return insets;
    });
    return container;
  }

  private boolean shouldKeepInWebView(Uri uri) {
    if (uri == null) {
      return true;
    }
    if ("https".equals(uri.getScheme()) && "co-web-umber.vercel.app".equals(uri.getHost())) {
      return false;
    }
    return true;
  }

  private void handlePermissionRequest(PermissionRequest request) {
    if (!"co-web-umber.vercel.app".equals(request.getOrigin().getHost())) {
      request.deny();
      return;
    }

    if (hasRequiredRuntimePermissions(request)) {
      grantWebPermissions(request);
      return;
    }

    pendingPermissionRequest = request;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      List<String> permissions = runtimePermissionsFor(request);
      requestPermissions(permissions.toArray(new String[0]), CAMERA_PERMISSION_REQUEST);
    } else {
      request.deny();
    }
  }

  private boolean hasRequiredRuntimePermissions(PermissionRequest request) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      return true;
    }

    for (String permission : runtimePermissionsFor(request)) {
      if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
        return false;
      }
    }
    return true;
  }

  private List<String> runtimePermissionsFor(PermissionRequest request) {
    List<String> permissions = new ArrayList<>();
    for (String resource : request.getResources()) {
      if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
        && !permissions.contains(Manifest.permission.CAMERA)) {
        permissions.add(Manifest.permission.CAMERA);
      }
      if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
        && !permissions.contains(Manifest.permission.RECORD_AUDIO)) {
        permissions.add(Manifest.permission.RECORD_AUDIO);
      }
    }
    return permissions;
  }

  private void grantWebPermissions(PermissionRequest request) {
    request.grant(request.getResources());
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != CAMERA_PERMISSION_REQUEST || pendingPermissionRequest == null) {
      return;
    }

    PermissionRequest request = pendingPermissionRequest;
    pendingPermissionRequest = null;
    if (hasRequiredRuntimePermissions(request)) {
      grantWebPermissions(request);
    } else {
      request.deny();
    }
  }

  @Override
  public void onBackPressed() {
    if (webView != null && webView.canGoBack()) {
      webView.goBack();
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
