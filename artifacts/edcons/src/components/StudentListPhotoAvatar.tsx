import { StudentPhotoAvatar, type StudentPhotoAvatarProps } from "@/components/StudentPhotoAvatar";

const dimensions = {
  sm: "size-8 rounded-full text-xs",
  md: "size-10 rounded-full text-sm",
};

type StudentListPhotoAvatarProps = Omit<StudentPhotoAvatarProps, "className"> & {
  size?: keyof typeof dimensions;
};

export function StudentListPhotoAvatar({ size = "sm", ...props }: StudentListPhotoAvatarProps) {
  return <StudentPhotoAvatar {...props} className={dimensions[size]} />;
}
