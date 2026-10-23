import { redirect } from "next/navigation";

// Checkout runs from the account page, where the subscription is tied to a signed-in account.
export default function CheckoutPage() {
  redirect("/account");
}
