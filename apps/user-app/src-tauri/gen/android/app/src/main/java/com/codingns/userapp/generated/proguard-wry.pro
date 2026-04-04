# THIS FILE IS AUTO-GENERATED. DO NOT MODIFY!!

# Copyright 2020-2023 Tauri Programme within The Commons Conservancy
# SPDX-License-Identifier: Apache-2.0
# SPDX-License-Identifier: MIT

-keep class com.codingns.userapp.* {
  native <methods>;
}

-keep class com.codingns.userapp.WryActivity {
  public <init>(...);

  void setWebView(com.codingns.userapp.RustWebView);
  java.lang.Class getAppClass(...);
  java.lang.String getVersion();
}

-keep class com.codingns.userapp.Ipc {
  public <init>(...);

  @android.webkit.JavascriptInterface public <methods>;
}

-keep class com.codingns.userapp.RustWebView {
  public <init>(...);

  void loadUrlMainThread(...);
  void loadHTMLMainThread(...);
  void evalScript(...);
}

-keep class com.codingns.userapp.RustWebChromeClient,com.codingns.userapp.RustWebViewClient {
  public <init>(...);
}
