# Implementation Plan: Accessibility Improvements

**Issues:** #518, #519, #531, #533  
**Branch:** `accessibility-improvements`  
**Author:** CillaSam

---

## Overview

This document outlines the implementation plan for four accessibility-focused issues that will improve the AutoMint frontend's compliance with WCAG standards and enhance usability for users with assistive technologies.

---

## Issue #531: No 404 or not-found handling

**Problem:**  
The App Router's `not-found.tsx` convention is unused, so an unknown route renders Next's default page with no header, footer, or navigation back into the app.

**Implementation Plan:**

1. **Create `frontend/src/app/not-found.tsx`**
   - Add a branded 404 page within the app shell
   - Include Header and Footer for consistent navigation
   - Provide clear messaging about the missing page
   - Add links to main routes (Home, Dashboard, Marketplace, Leaderboard)
   - Ensure all navigation is keyboard accessible
   - Use semantic HTML and appropriate ARIA labels

2. **Add marketplace-specific not-found handling**
   - Create route-specific error handling for nonexistent bot IDs
   - Display helpful message with link back to marketplace
   - Maintain consistent styling with the app

**Acceptance Criteria:**
- Unknown routes render within the app shell with header/footer
- Nonexistent bot IDs show a specific message with navigation
- All elements are keyboard navigable
- Proper semantic HTML structure

---

## Issue #518: Points counters use `aria-live="polite"` on continuously updating values

**Problem:**  
`ClaimButton` and `PointsCounter` mark continuously-updating point values with `aria-live="polite"`, causing screen readers to announce updates every second, making the page unusable with assistive technology.

**Implementation Plan:**

1. **Update `frontend/src/components/dashboard/ClaimButton.tsx`**
   - Remove `aria-live` and `aria-atomic` from the pending points display
   - Keep the value accessible via `aria-labelledby` for static reading
   - Add a separate debounced live region for meaningful events only

2. **Update `frontend/src/components/dashboard/PointsCounter.tsx`**
   - Remove `aria-live="polite"` and `aria-atomic="true"` from the animated points display
   - Add screen-reader-only static summary
   - Create a debounced announcement mechanism for significant events:
     - Claim completion
     - Crossing AMT threshold
     - Rate changes

3. **Create `frontend/src/hooks/useAccessibleAnnouncement.ts`**
   - Implement debounced live region hook
   - Ensure announcements don't occur more than once every 10 seconds
   - Provide API for components to trigger announcements on meaningful events

**Acceptance Criteria:**
- No live region updates more frequently than once per 10 seconds
- Completed claims are announced once
- Screen readers can read the page without constant interruption
- Current point totals remain accessible for on-demand reading

---

## Issue #519: Animated counter ignores `prefers-reduced-motion`

**Problem:**  
`PointsCounter` runs a `requestAnimationFrame` easing loop, and all components use `framer-motion` entrance animations without checking `prefers-reduced-motion`, violating WCAG 2.3.3 and potentially causing issues for users with vestibular disorders.

**Implementation Plan:**

1. **Create `frontend/src/providers/MotionConfigProvider.tsx`**
   - Create a global motion configuration provider
   - Use `framer-motion`'s `useReducedMotion` hook
   - Provide context to disable animations when OS setting is enabled
   - Ensure setting is respected without page reload

2. **Update `frontend/src/components/dashboard/PointsCounter.tsx`**
   - Modify `useAnimatedNumber` hook to check reduced motion preference
   - When reduced motion is enabled, snap values instantly instead of animating
   - Remove easing when preference is set

3. **Update all components using `framer-motion`**
   - Wrap motion components to respect global reduced motion preference
   - Components affected:
     - `ClaimButton.tsx`
     - `PointsCounter.tsx`
     - Other components with entrance animations
   - Use conditional animation props based on reduced motion context

4. **Add motion provider to app root**
   - Update `frontend/src/app/providers.tsx` or `layout.tsx`
   - Ensure provider wraps entire app
   - Test that preference is detected and applied correctly

**Acceptance Criteria:**
- With OS `prefers-reduced-motion` enabled, no entrance animations play
- Numbers update instantly without easing
- Setting is respected without page reload
- Single provider controls behavior globally

---

## Issue #533: Add automated accessibility testing to the suite

**Problem:**  
Several components have ARIA attributes while others don't, with no enforcement mechanism. There's no axe integration, making accessibility regressions invisible until users encounter them.

**Implementation Plan:**

1. **Update `frontend/package.json`**
   - Verify `jest-axe` is installed (already present in devDependencies)
   - Add `eslint-plugin-jsx-a11y` to devDependencies
   - Update test scripts if needed

2. **Update `frontend/.eslintrc.json`**
   - Add `eslint-plugin-jsx-a11y` to plugins array
   - Add recommended a11y rules to extends
   - Configure rule overrides as needed for project specifics
   - Ensure linting fails on a11y violations

3. **Create `frontend/src/__tests__/a11y.test.tsx`**
   - Import and configure `jest-axe`
   - Create comprehensive test suite covering:
     - Every page component (landing, dashboard, marketplace, leaderboard, profile)
     - Every component in key states:
       - Loading state
       - Empty state
       - Error state
       - Populated state
       - Modal/dialog open state
   - Use `axe` matcher from `jest-axe`
   - Ensure test fails on newly introduced violations

4. **Fix any existing violations discovered**
   - Run the new test suite
   - Document all violations found
   - Fix violations or explicitly document why they can't be fixed
   - Ensure codebase passes all checks

5. **Update CI/CD configuration**
   - Ensure a11y tests run in CI pipeline
   - Ensure ESLint a11y rules are checked in CI
   - Block merges on a11y test failures

**Acceptance Criteria:**
- `jest-axe` test covers all pages and components
- All component states (loading, empty, error, populated, modal) are tested
- Test suite fails when new violations are introduced
- `eslint-plugin-jsx-a11y` is enabled and codebase passes
- CI/CD enforces a11y checks

---

## Implementation Order

1. **Phase 1:** Issue #531 (404 handling) - Standalone, no dependencies
2. **Phase 2:** Issue #519 (Reduced motion) - Foundation for other improvements
3. **Phase 3:** Issue #518 (aria-live fixes) - Depends on motion provider being in place
4. **Phase 4:** Issue #533 (Automated testing) - Validate all previous changes

---

## Testing Strategy

### Manual Testing
- Test with keyboard navigation only
- Test with screen reader (NVDA, JAWS, or VoiceOver)
- Test with OS `prefers-reduced-motion` enabled/disabled
- Test 404 pages and invalid routes
- Verify no console errors or warnings

### Automated Testing
- All new components have unit tests
- Integration tests cover key user flows
- Axe tests cover all pages and states
- ESLint checks pass
- All existing tests continue to pass

---

## Files to be Modified

### New Files
- `frontend/src/app/not-found.tsx`
- `frontend/src/hooks/useAccessibleAnnouncement.ts`
- `frontend/src/providers/MotionConfigProvider.tsx`
- `frontend/src/__tests__/a11y.test.tsx`

### Modified Files
- `frontend/src/components/dashboard/ClaimButton.tsx`
- `frontend/src/components/dashboard/PointsCounter.tsx`
- `frontend/.eslintrc.json`
- `frontend/package.json`
- `frontend/src/app/providers.tsx` or `frontend/src/app/layout.tsx`
- Other components using `framer-motion` entrance animations

---

## Notes

- All changes maintain backward compatibility with existing functionality
- Performance impact is minimal (reduced motion check is lightweight)
- Changes improve both accessibility and user experience for all users
- Implementation follows Next.js App Router conventions
- All code follows existing project style and TypeScript standards

---

## Definition of Done

- [ ] All four issues (#518, #519, #531, #533) are resolved
- [ ] All acceptance criteria are met for each issue
- [ ] All tests pass (existing and new)
- [ ] ESLint passes with new a11y rules
- [ ] Manual accessibility testing completed
- [ ] Code reviewed and approved
- [ ] Changes merged to main branch
- [ ] Issues closed with PR link
