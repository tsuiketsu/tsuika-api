import type { ReactNode as Rn } from "hono/jsx";
import { Resend } from "resend";
import { OTPTemplate } from "tsuika-react-email-templates";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMail(email: string, subject: string, react: Rn) {
  try {
    const { data, error } = await resend.emails.send({
      from: "Tsuika <onbording@tsuika.space>",
      to: email,
      subject,
      react,
    });

    if (error || !data?.id) {
      console.error("Failed to send email", error);
    }

    console.log("Successfully sent email!");
  } catch (error) {
    console.error("Faled to send email", error);
  }
}

interface SendOtpProps {
  email: string;
  otp: string;
  subject?: string;
  fallbackUrl: string;
}

export async function sendOTP(props: SendOtpProps) {
  const { email, otp, subject = "Confirm your email", fallbackUrl } = props;

  const react = OTPTemplate({
    otp,
    projectName: "Tsuika",
    heading: subject,
    fallbackUrl,
    description:
      "Please enter the following One-Time Password (OTP) for email. This OTP is" +
      " valid for about 1 hour; before that, you can't request a new one.",
    socialLinks: [
      { label: "GitHub", href: "https://github.com/ImRayy/tsuika" },
      { label: "E-Mail", href: "mailto:imrayy.wklem@aleeas.com" },
    ],
  });
  return await sendMail(email, subject, react);
}
