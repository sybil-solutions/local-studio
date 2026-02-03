# AGENTS.md

## CRITICAL SWIFT BUILD REQUIREMENTS

**BEFORE MAKING ANY SWIFT CHANGES, READ THIS ENTIRE SECTION.**

### MANDATORY PRE-COMMIT CHECKS

1. **REGENERATE XCODE PROJECT AFTER ANY FILE CHANGES**
   ```bash
   cd swift-client
   ./setup.sh
   ```
   - New files are NOT automatically included in the Xcode project
   - Moving files breaks references
   - The project MUST be regenerated after adding/moving/renaming Swift files

2. **VERIFY BUILD COMPILES (TERMINAL)**
   ```bash
   cd swift-client
   xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio -destination 'platform=iOS Simulator,name=iPhone 15' clean build
   echo $?  # MUST be 0 (success)
   ```
   - **DO NOT COMMIT CHANGES THAT DO NOT BUILD**
   - Fix ALL compilation errors before proceeding
   - Check for warnings that may indicate runtime issues

3. **COMMON SWIFT BUILD ERRORS TO AVOID**

   ❌ **WRONG**: Using undefined functions across file boundaries
   ```swift
   // File A
   extension MyClass {
     func helperMethod() -> String { ... }
   }
   
   // File B - WILL NOT COMPILE
   extension MyClass {
     func caller() {
       let x = helperMethod() // ERROR: Cannot find 'helperMethod' in scope
     }
   }
   ```
   
   ✅ **CORRECT**: Keep related functions in the same file or mark as public
   ```swift
   // CRITICAL marker if file exceeds 60 lines
   extension MyClass {
     func caller() {
       let x = helperMethod()
     }
     
     func helperMethod() -> String { ... }
   }
   ```

   ❌ **WRONG**: Using enum cases without full qualification
   ```swift
   .preferredColorScheme(.dark) // ERROR in some contexts
   ```
   
   ✅ **CORRECT**: Use full type name
   ```swift
   .preferredColorScheme(ColorScheme.dark)
   ```

   ❌ **WRONG**: Adding initializers in separate files causing ambiguity
   ```swift
   // File: struct definition
   struct MyStruct {
     init(a: String) { ... }
   }
   
   // File: extension
   extension MyStruct {
     init(a: String, b: Int) { ... } // May cause "Extra arguments" errors
   }
   ```
   
   ✅ **CORRECT**: Add optional parameters to original init
   ```swift
   struct MyStruct {
     init(a: String, b: Int? = nil) { ... }
   }
   ```

4. **SWIFT IMPORT REQUIREMENTS**
   - **UIKit**: Required for `UIImage`, `UIApplication`, `UIResponder`
   - **SwiftUI**: Required for all views
   - **Foundation**: Required for `URL`, `Data`, `UUID`, etc.
   - **AVFoundation**: Required for audio recording
   - **PhotosUI**: Required for `PhotosPicker`
   
   **DO NOT ASSUME TRANSITIVE IMPORTS** - explicitly import what you use.

5. **FILE ORGANIZATION RULES**
   - Files ≤60 lines: No marker needed
   - Files >60 lines: **MUST** start with `// CRITICAL`
   - Max 20 files per directory: Create subdirectories if needed
   - Use kebab-case for file/directory names: `my-view.swift` NOT `MyView.swift`
   - After moving files to subdirectories, **REGENERATE THE PROJECT**

6. **SCOPE AND VISIBILITY**
   - Swift extensions in separate files can access public/internal members
   - Private members are file-scoped and NOT accessible across extensions
   - When splitting a file, either:
     - Move related private methods together
     - Change visibility to internal
     - Consolidate into one file with `// CRITICAL` marker

### VERIFICATION WORKFLOW

**MANDATORY STEPS BEFORE COMPLETING SWIFT WORK:**

```bash
# 1. Regenerate project
cd swift-client
./setup.sh

# 2. Build in Xcode (opens automatically) or CLI:
xcodebuild -project vllm-studio.xcodeproj -scheme vllm-studio \
  -destination 'platform=iOS Simulator,name=iPhone 15' clean build

# 3. Check exit code
echo $?  # MUST be 0 (success)

# 4. If errors, READ THE ERROR MESSAGES and fix them
# Common patterns:
# - "Cannot find X in scope" → Missing import or wrong file
# - "Extra arguments" → Init signature mismatch
# - "Cannot infer contextual base" → Missing type qualification
```

### DEBUGGING BUILD ERRORS

When Xcode shows compilation errors:

1. **Read the actual error message** - don't guess
2. **Check the file path** - is the file in the project?
3. **Verify imports** - does the file import required frameworks?
4. **Check scope** - are you calling private methods from another file?
5. **Validate extensions** - are all extension members accessible?

### COMMON FIX PATTERNS

| Error | Fix |
|-------|-----|
| Cannot find 'FunctionName' in scope | Move function to same file OR make it public |
| Cannot find type 'DrawerShell' | Run `./setup.sh` to regenerate project |
| Cannot infer contextual base in reference to member 'dark' | Use `ColorScheme.dark` instead of `.dark` |
| Extra arguments at positions #X, #Y | Check init signature - may have duplicate inits |
| Value of type 'X' has no member 'Y' | Add missing import (UIKit, SwiftUI, etc.) |

---

## Frontend (Next.js/React)

### Build Verification
```bash
cd frontend
npm run build  # MUST succeed before committing
npm run lint   # Fix all linting errors
```

### Docker Rebuild Required
After frontend changes:
```bash
docker compose up -d --build frontend
```

---

## Controller (Bun/TypeScript)

### Type Checking
```bash
cd controller
bun run typecheck  # Verify TypeScript types
bun test           # Run test suite
```

---

## Repository Conventions

- **60 LOC limit**: Files >60 lines MUST have `// CRITICAL`, `# CRITICAL`, or `<!-- CRITICAL -->`
- **20 files per directory**: Create subdirectories when exceeded
- **kebab-case naming**: ALL files/directories use kebab-case
- **No camelCase/PascalCase in filenames**: `my-component.tsx` NOT `MyComponent.tsx`

---

## FINAL CHECKLIST BEFORE COMPLETING WORK

- [ ] All Swift files compile without errors
- [ ] Xcode project regenerated with `./setup.sh`
- [ ] Test build succeeds: `xcodebuild ... clean build`
- [ ] No files exceed 60 LOC without `// CRITICAL` marker
- [ ] No directories exceed 20 files
- [ ] All filenames use kebab-case
- [ ] Required imports added (UIKit, AVFoundation, etc.)
- [ ] No scope errors (functions accessible where called)

---

## Codex Skills (Repo-Scoped)

Use these skills when working on operations or backend architecture:
- `skills/vllm-studio` — setup, deployment, env keys, releases.
- `skills/vllm-studio-backend` — controller/runtime architecture + OpenAI-compatible endpoints.

To install into Codex skills:
```
cp -R skills/vllm-studio ~/.codex/skills/
cp -R skills/vllm-studio-backend ~/.codex/skills/
```

**IF ANY ITEM FAILS, FIX IT BEFORE CLAIMING COMPLETION.**
