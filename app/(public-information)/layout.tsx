import PublicInformationLayout from "@/app/components/public-information-layout";

export default function PublicDataPortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <PublicInformationLayout>{children}</PublicInformationLayout>;
}
