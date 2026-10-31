// One wallet transaction: simulate first (so a program error is explained before the wallet opens),
// then sign and send through the wallet, then wait for confirmation.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type Signature,
  type TransactionSendingSigner,
} from "@solana/kit";
import { describeFailure, isWalletRejection, type Failure } from "./errors";
import { rpc } from "./rpc";

export class TxFailure extends Error {
  constructor(readonly failure: Failure) {
    super(failure.message);
  }
}

export class TxRejected extends Error {}

type Blockhash = Awaited<ReturnType<ReturnType<typeof rpc.getLatestBlockhash>["send"]>>["value"];

async function buildMessage(signer: TransactionSendingSigner, instructions: Instruction[], blockhash: Blockhash) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

/** Runs the transaction in simulation; throws TxFailure with the reason in plain words. */
async function simulate(message: Awaited<ReturnType<typeof buildMessage>>, programs: Address[]) {
  const wire = getBase64EncodedWireTransaction(compileTransaction(message));
  const { value } = await rpc
    .simulateTransaction(wire, { encoding: "base64", sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" })
    .send();
  if (value.err) throw new TxFailure(describeFailure(value.err, programs, value.logs ?? []));
}

async function waitForConfirmation(signature: Signature, lastValidBlockHeight: bigint): Promise<void> {
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new TxFailure(describeFailure(status.err, [], []));
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return;
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (height > lastValidBlockHeight) {
      throw new TxFailure({
        title: "The transaction did not land",
        message: "Solana did not include it in time, so nothing moved. Try again.",
      });
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

export type SendHooks = {
  /** Simulation passed and the wallet prompt is open. */
  onSigning?: () => void;
  /** The wallet approved; the transaction is on its way. */
  onSent?: (signature: Signature) => void;
};

export async function sendInstructions(
  signer: TransactionSendingSigner,
  instructions: Instruction[],
  hooks: SendHooks = {},
): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = await buildMessage(signer, instructions, blockhash);
  await simulate(
    message,
    instructions.map((ix) => ix.programAddress),
  );

  hooks.onSigning?.();
  let signature: Signature;
  try {
    const bytes = await signAndSendTransactionMessageWithSigners(message);
    signature = getBase58Decoder().decode(bytes) as Signature;
  } catch (error) {
    if (isWalletRejection(error)) throw new TxRejected("Declined in the wallet");
    throw new TxFailure(describeFailure(error, [], []));
  }
  hooks.onSent?.(signature);
  await waitForConfirmation(signature, blockhash.lastValidBlockHeight);
  return signature;
}
