# 3. No visitor identity by default

The default mode has **no visitor identifier**. Collection still requires an explicit grant (`recordConsent` / `setConsent` to `granted`) for analytics and measurement purposes.

App-scoped visitor ids are opt-in (`visitorIdentity: "app-scoped"`), never cross-project, and are not created before consent. There is no identify API that links anonymous and signed-in subjects.
