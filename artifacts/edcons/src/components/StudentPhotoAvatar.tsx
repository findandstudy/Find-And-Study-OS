import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { studentPhotoSources } from "@/lib/studentPhotoSources";
import { cn } from "@/lib/utils";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
const LazyPdfPhotoAvatar = lazy(() => import("@/components/PdfPhotoAvatar"));

export interface StudentPhotoAvatarProps {
  studentId: number | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
  photoUrl?: string | null;
  hasPhoto?: boolean | null;
  revision?: number;
  className?: string;
}

export function StudentPhotoAvatar(props: StudentPhotoAvatarProps) {
  const { studentId, photoUrl, hasPhoto, revision } = props;
  return <StudentPhoto key={JSON.stringify([studentId, photoUrl, hasPhoto, revision])} {...props} />;
}

/** A real photo takes priority over initials on every student surface. */
function StudentPhoto({
  studentId,
  firstName,
  lastName,
  photoUrl,
  hasPhoto,
  revision,
  className = "size-14 rounded-full text-sm",
}: StudentPhotoAvatarProps) {
  const initials = ((firstName?.[0] ?? "") + (lastName?.[0] ?? "")).toUpperCase() || "?";
  const alt = [firstName, lastName].filter(Boolean).join(" ");
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const { images, pdf } = studentPhotoSources({
    base: BASE_URL, origin: globalThis.location?.origin, studentId, photoUrl, hasPhoto, revision,
  });
  const source = images[attempt];
  const canLoad = images.length > 0;

  useEffect(() => {
    if (!canLoad) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: 0, rootMargin: "200px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canLoad]);

  const imageClass = "size-full rounded-[inherit] object-cover border border-primary/20";
  const fallback = (
    <div className="flex size-full items-center justify-center rounded-[inherit] bg-gradient-to-br from-primary/20 to-primary/10 font-bold text-primary">
      {initials}
    </div>
  );

  return (
    <div ref={containerRef} className={cn("shrink-0 overflow-hidden", className)}>
      {!inView ? fallback : source ? (
        <img
          key={source}
          src={source}
          alt={alt}
          className={imageClass}
          loading="lazy"
          decoding="async"
          onError={() => setAttempt(attempt + 1)}
        />
      ) : pdf ? (
        <Suspense fallback={fallback}>
          <LazyPdfPhotoAvatar src={pdf} alt={alt} className={imageClass} fallback={fallback} />
        </Suspense>
      ) : fallback}
    </div>
  );
}
