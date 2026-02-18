# swift-client

SwiftUI client for vLLM Studio.

- Sources: `swift-client/sources`
- Info.plist: `swift-client/resources/info.plist`
- Update backend URL + API key in the Configs tab inside the app.

## Build Notes

```bash
cd swift-client
./setup.sh
./verify-build.sh
```

- `setup.sh` regenerates `vllm-studio.xcodeproj` from `project.yml`.
- Regenerate after any Swift file add/move/rename.
- `verify-build.sh` runs iOS + macOS build checks used by contributors.

## Running the correct app on Mac

Use the **`vllm-studio-mac`** scheme for desktop macOS.
The iOS target is configured to not run as a "Designed for iPad" Mac app.

## Local device sync pipeline

```bash
cd swift-client
./sync-devices.sh
```

What it does:
- Regenerates the Xcode project
- Builds + installs `vllm-studio-mac.app` to `~/Applications`
- Builds iOS for a connected iPhone and attempts install via `devicectl`

If your iPhone is not auto-detected, pass the device ID manually:

```bash
./sync-devices.sh <IOS_DEVICE_ID>
```
