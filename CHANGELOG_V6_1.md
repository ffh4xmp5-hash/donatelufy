# LUFY X DONATE V6.1

## Changes
- Removed email verification requirement and verification flow.
- Registration no longer blocks on Gmail verification.
- Password reset email remains optional and is separate from verification.
- Added `TRUEWALLET_OWNER_PHONE` for the owner's TrueMoney receiving number used on member credit top-up instructions.
- Added `truewallet_phone` per Creator for TrueMoney donation recipient number.
- Creator dashboard can save a TrueMoney recipient phone number.
- Creator donation page displays and can copy the configured TrueMoney recipient number.
- TrueMoney top-up/donation flows do not pretend to transfer money automatically; the user completes the transfer in TrueMoney.
- Admin still reviews top-up slips before crediting credits.

## TrueMoney automation
For true automatic payment confirmation, connect an eligible TrueMoney merchant/Open API integration and webhook. A phone number alone cannot make a web browser silently send or receive money.
