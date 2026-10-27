import {
  startTransition,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSkySelection } from "../hooks/use-sky-selection";
import { pages } from "./pages";
import { NotFoundPage } from "../pages/NotFoundPage";
import {
  notFoundTitle,
  redirectFor,
  routeTitle,
} from "../domain/route";
import {
  isRoutePath,
  normalizePath,
  readScrollPosition,
  emitNavigation,
  saveScrollPosition,
  scrollToHash,
  subscribeToNavigation,
} from "./browser-location";


type NavigationSource = "load" | "push" | "pop";

export default function App() {
  useSkySelection();
  const [location, setLocation] = useState(
    () => `${window.location.pathname}${window.location.hash}`,
  );
  const navigationSource = useRef<NavigationSource>("load");
  const pendingScroll = useRef(readScrollPosition());
  const pathname = normalizePath(location.split("#")[0] ?? "");
  const redirect = redirectFor(pathname);
  const Page = isRoutePath(pathname) ? pages[pathname] : null;
  useEffect(() => {
    if (!redirect) return;
    window.history.replaceState(window.history.state, "", redirect);
    emitNavigation();
  }, [redirect]);

  useEffect(() => {
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    function updateLocation(source: NavigationSource) {
      navigationSource.current = source;
      startTransition(() => {
        setLocation(`${window.location.pathname}${window.location.hash}`);
      });
    }
    let saveFrame = 0;
    function handlePushNavigation() {
      pendingScroll.current = null;
      updateLocation("push");
    }
    function handlePopState() {
      pendingScroll.current = readScrollPosition();
      updateLocation("pop");
    }
    function saveCurrentScroll() {
      saveFrame = 0;
      saveScrollPosition();
    }
    function scheduleScrollSave() {
      if (saveFrame === 0) saveFrame = window.requestAnimationFrame(saveCurrentScroll);
    }

    const unsubscribe = subscribeToNavigation(handlePushNavigation);
    window.addEventListener("scroll", scheduleScrollSave, { passive: true });
    window.addEventListener("popstate", handlePopState);
    return () => {
      if (saveFrame !== 0) window.cancelAnimationFrame(saveFrame);
      saveScrollPosition();
      window.history.scrollRestoration = previousScrollRestoration;
      unsubscribe();
      window.removeEventListener("scroll", scheduleScrollSave);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    document.title = isRoutePath(pathname)
      ? routeTitle(pathname)
      : notFoundTitle();
    const hash = window.location.hash;
    let frame = 0;
    let timeout = 0;
    let observer: MutationObserver | undefined;

    const stopWaiting = () => {
      observer?.disconnect();
      window.clearTimeout(timeout);
    };
    const finishNavigation = () => {
      if (hash) return scrollToHash(hash);
      const savedPosition = pendingScroll.current;
      if (savedPosition && navigationSource.current !== "push") {
        const maxScroll = Math.max(
          0,
          document.documentElement.scrollHeight - window.innerHeight,
        );
        if (maxScroll + 1 < savedPosition.y) return false;
        window.scrollTo({
          left: savedPosition.x,
          top: savedPosition.y,
          behavior: "instant",
        });
        pendingScroll.current = null;
        return true;
      }
      if (navigationSource.current !== "push") return true;
      window.scrollTo({ top: 0, behavior: "instant" });
      const heading = document.querySelector("main h1, [data-page-focus]");
      if (!(heading instanceof HTMLElement)) return false;
      heading.focus({ preventScroll: true });
      return true;
    };

    frame = window.requestAnimationFrame(() => {
      if (finishNavigation()) return;
      observer = new MutationObserver(() => {
        if (finishNavigation()) stopWaiting();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timeout = window.setTimeout(stopWaiting, 3000);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      stopWaiting();
    };
  }, [location, pathname]);

  if (!Page) return <NotFoundPage />;
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
