#import <UIKit/UIKit.h>
#import <dispatch/dispatch.h>

static void codingns_run_haptic_feedback(NSString *kind) {
  if ([kind isEqualToString:@"selection"] || [kind isEqualToString:@"gesture"]) {
    UISelectionFeedbackGenerator *generator = [[UISelectionFeedbackGenerator alloc] init];
    [generator prepare];
    [generator selectionChanged];
    return;
  }

  if ([kind isEqualToString:@"success"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator prepare];
    [generator notificationOccurred:UINotificationFeedbackTypeSuccess];
    return;
  }

  if ([kind isEqualToString:@"warning"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator prepare];
    [generator notificationOccurred:UINotificationFeedbackTypeWarning];
    return;
  }

  if ([kind isEqualToString:@"error"]) {
    UINotificationFeedbackGenerator *generator = [[UINotificationFeedbackGenerator alloc] init];
    [generator prepare];
    [generator notificationOccurred:UINotificationFeedbackTypeError];
    return;
  }

  UIImpactFeedbackStyle style =
    [kind isEqualToString:@"action"] ? UIImpactFeedbackStyleMedium : UIImpactFeedbackStyleLight;
  UIImpactFeedbackGenerator *generator =
    [[UIImpactFeedbackGenerator alloc] initWithStyle:style];
  [generator prepare];
  [generator impactOccurred];
}

extern "C" void codingns_perform_haptic_feedback(const char *kind) {
  NSString *resolvedKind =
    kind == nullptr ? @"" : [NSString stringWithUTF8String:kind];

  if ([NSThread isMainThread]) {
    codingns_run_haptic_feedback(resolvedKind);
    return;
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    codingns_run_haptic_feedback(resolvedKind);
  });
}
