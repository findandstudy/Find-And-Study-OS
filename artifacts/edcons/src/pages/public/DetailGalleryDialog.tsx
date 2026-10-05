import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { DetailContentSection } from "@/lib/website/detailContentContract";

type DetailImage = NonNullable<DetailContentSection["images"]>[number];

export default function DetailGalleryDialog({
  image,
  title,
  locale,
  onClose,
  onClosedAutoFocus,
}: {
  image: DetailImage;
  title: string;
  locale: string;
  onClose: () => void;
  onClosedAutoFocus: () => boolean;
}) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent
      className="w-[calc(100%_-_2rem)] max-w-4xl max-h-[90vh] overflow-y-auto rtl:[&>button]:right-auto rtl:[&>button]:left-4"
      aria-describedby={undefined}
      dir={["ar", "fa", "ur"].includes(locale) ? "rtl" : "ltr"}
      onCloseAutoFocus={event => {
        if (onClosedAutoFocus()) event.preventDefault();
      }}
    >
      <DialogTitle className="min-w-0 break-words pe-7 text-start">{image.caption || image.alt || title}</DialogTitle>
      <img src={image.src} alt={image.alt} className="max-h-[70vh] w-full object-contain" />
    </DialogContent>
  </Dialog>;
}
