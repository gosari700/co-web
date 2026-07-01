package com.saja77.coweb;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {
  private static final String APP_URL = "https://co-web-umber.vercel.app/";
  private static final int CAMERA_PERMISSION_REQUEST = 77;
  private static final String GOOGLE_TTS_ENGINE = "com.google.android.tts";

  private WebView webView;
  private PermissionRequest pendingPermissionRequest;
  private TextToSpeech textToSpeech;
  private boolean textToSpeechReady = false;
  private SpeechRequest pendingSpeechRequest;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    configureWindow();
    initializeTextToSpeech();
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
    webView.addJavascriptInterface(new NativeSpeechBridge(), "CoWebNativeSpeech");
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

  private void initializeTextToSpeech() {
    createTextToSpeech(GOOGLE_TTS_ENGINE, true);
  }

  private void createTextToSpeech(String engineName, boolean allowDefaultFallback) {
    textToSpeechReady = false;
    TextToSpeech.OnInitListener listener = status -> handleTextToSpeechInit(status, allowDefaultFallback);
    if (engineName == null || engineName.isEmpty()) {
      textToSpeech = new TextToSpeech(this, listener);
    } else {
      textToSpeech = new TextToSpeech(this, listener, engineName);
    }
  }

  private void handleTextToSpeechInit(int status, boolean allowDefaultFallback) {
    if (status != TextToSpeech.SUCCESS) {
      if (allowDefaultFallback) {
        if (textToSpeech != null) {
          textToSpeech.shutdown();
          textToSpeech = null;
        }
        runOnUiThread(() -> createTextToSpeech(null, false));
        return;
      }
      textToSpeechReady = false;
      notifyPendingNativeSpeechFailure();
      return;
    }

    textToSpeechReady = true;
    if (textToSpeech != null) {
      textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
        @Override
        public void onStart(String utteranceId) {
        }

        @Override
        public void onDone(String utteranceId) {
          notifyNativeSpeechDone(utteranceId, true);
        }

        @Override
        public void onError(String utteranceId) {
          notifyNativeSpeechDone(utteranceId, false);
        }

        @Override
        public void onStop(String utteranceId, boolean interrupted) {
          notifyNativeSpeechDone(utteranceId, !interrupted);
        }
      });
    }

    SpeechRequest request = pendingSpeechRequest;
    pendingSpeechRequest = null;
    if (request != null) {
      runOnUiThread(() -> speakNativeText(request));
    }
  }

  private void notifyPendingNativeSpeechFailure() {
    SpeechRequest request = pendingSpeechRequest;
    pendingSpeechRequest = null;
    if (request != null) {
      notifyNativeSpeechDone(request.utteranceId, false);
    }
  }

  private void speakNativeText(SpeechRequest request) {
    if (request == null || request.text.isEmpty() || request.utteranceId.isEmpty()) {
      if (request != null) {
        notifyNativeSpeechDone(request.utteranceId, false);
      }
      return;
    }

    if (textToSpeech == null || !textToSpeechReady) {
      pendingSpeechRequest = request;
      return;
    }

    textToSpeech.stop();
    int languageResult = textToSpeech.setLanguage(localeForLanguageTag(request.languageTag));
    if (languageResult == TextToSpeech.LANG_MISSING_DATA
      || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
      languageResult = textToSpeech.setLanguage(Locale.US);
    }
    if (languageResult == TextToSpeech.LANG_MISSING_DATA
      || languageResult == TextToSpeech.LANG_NOT_SUPPORTED) {
      notifyNativeSpeechDone(request.utteranceId, false);
      return;
    }

    textToSpeech.setPitch(normalizeSpeechValue(request.pitch, 1.08f));
    textToSpeech.setSpeechRate(normalizeSpeechValue(request.rate, 0.92f));
    int result = textToSpeech.speak(
      request.text,
      TextToSpeech.QUEUE_FLUSH,
      null,
      request.utteranceId
    );
    if (result == TextToSpeech.ERROR) {
      notifyNativeSpeechDone(request.utteranceId, false);
    }
  }

  private Locale localeForLanguageTag(String languageTag) {
    String normalized = languageTag == null ? "" : languageTag.trim();
    if (normalized.isEmpty()) {
      return Locale.US;
    }
    Locale locale = Locale.forLanguageTag(normalized);
    if (locale.getLanguage().isEmpty()) {
      return Locale.US;
    }
    return locale;
  }

  private float normalizeSpeechValue(float value, float fallback) {
    if (value <= 0.0f) {
      return fallback;
    }
    return Math.max(0.1f, Math.min(2.0f, value));
  }

  private void notifyNativeSpeechDone(String utteranceId, boolean didSpeak) {
    if (utteranceId == null || utteranceId.isEmpty()) {
      return;
    }
    runOnUiThread(() -> {
      if (webView == null) {
        return;
      }
      String script = "window.__coWebNativeSpeechDone&&window.__coWebNativeSpeechDone("
        + quoteJsString(utteranceId)
        + ","
        + (didSpeak ? "true" : "false")
        + ")";
      webView.evaluateJavascript(script, null);
    });
  }

  private String quoteJsString(String value) {
    return "\""
      + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
      + "\"";
  }

  private class NativeSpeechBridge {
    @JavascriptInterface
    public boolean isAvailable() {
      return textToSpeech != null;
    }

    @JavascriptInterface
    public void speak(String text, String languageTag, float pitch, float rate, String utteranceId) {
      SpeechRequest request = new SpeechRequest(text, languageTag, pitch, rate, utteranceId);
      runOnUiThread(() -> speakNativeText(request));
    }

    @JavascriptInterface
    public void stop() {
      runOnUiThread(() -> {
        if (textToSpeech != null) {
          textToSpeech.stop();
        }
      });
    }
  }

  private static class SpeechRequest {
    final String text;
    final String languageTag;
    final float pitch;
    final float rate;
    final String utteranceId;

    SpeechRequest(String text, String languageTag, float pitch, float rate, String utteranceId) {
      this.text = text == null ? "" : text.trim();
      this.languageTag = languageTag == null ? "" : languageTag.trim();
      this.pitch = pitch;
      this.rate = rate;
      this.utteranceId = utteranceId == null ? "" : utteranceId.trim();
    }
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
    if (textToSpeech != null) {
      textToSpeech.stop();
      textToSpeech.shutdown();
      textToSpeech = null;
      textToSpeechReady = false;
      pendingSpeechRequest = null;
    }
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }
}
