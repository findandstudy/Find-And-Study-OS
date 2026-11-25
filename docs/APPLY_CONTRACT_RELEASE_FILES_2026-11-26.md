# Apply sözleşme düzeltmesi — dosya envanteri

Ürün imajı: 25164abd3616606029584f0c5a60c0a45f4e8aa8. Test-only son kaynak: 56f176d04b1c7f4848b87318a7f14968988e6e78.
Taban: a5f31e06568229d5f61fa29a1416dd46b83119b0 + salt okunur doğrulanan canlı kaynak farkları.

A: yeni dosya; M: değişen dosya. Aşağıdaki Git farkı 72 dosyadır. Kanıt/ön kontrol belgelerinin sonraki commitleri ürün imajını değiştirmez.

| Durum | Dosya |
|---|---|
| A | artifacts/api-server/scripts/recover-contract47.ts |
| A | artifacts/api-server/scripts/test-agent-contract-lifecycle.ts |
| A | artifacts/api-server/scripts/test-agent-contract-template-selection.ts |
| A | artifacts/api-server/scripts/test-contract-css-preservation.ts |
| A | artifacts/api-server/scripts/test-contract-delivery-migration-prefix.ts |
| A | artifacts/api-server/scripts/test-contract-durable-delivery.ts |
| A | artifacts/api-server/scripts/test-contract-durable-enrollment.ts |
| A | artifacts/api-server/scripts/test-contract-local-logo.ts |
| A | artifacts/api-server/scripts/test-contract-logo-wiring.ts |
| A | artifacts/api-server/scripts/test-contract-pdf-assets.ts |
| A | artifacts/api-server/scripts/test-contract-pdf-render-boundary.ts |
| A | artifacts/api-server/scripts/test-contract-render-browser.ts |
| M | artifacts/api-server/scripts/test-contract-sign.ts |
| A | artifacts/api-server/scripts/test-contract-smtp-adapter.ts |
| A | artifacts/api-server/scripts/test-contract47-recovery-pg.ts |
| A | artifacts/api-server/scripts/test-contract47-recovery.ts |
| A | artifacts/api-server/scripts/test-signed-contract-pdf-recovery.ts |
| M | artifacts/api-server/src/lib/agentApplicationLifecycle.ts |
| A | artifacts/api-server/src/lib/agentSignedContractSummary.ts |
| A | artifacts/api-server/src/lib/contract47Recovery.ts |
| M | artifacts/api-server/src/lib/contractBranding.ts |
| A | artifacts/api-server/src/lib/contractDeliveryPdf.ts |
| A | artifacts/api-server/src/lib/contractDeliveryPolicy.ts |
| A | artifacts/api-server/src/lib/contractDeliveryStatus.ts |
| A | artifacts/api-server/src/lib/contractDeliveryStore.ts |
| A | artifacts/api-server/src/lib/contractDeliveryWorker.ts |
| M | artifacts/api-server/src/lib/contractHtmlSanitizer.ts |
| M | artifacts/api-server/src/lib/contractPdf.ts |
| A | artifacts/api-server/src/lib/contractPdfAssets.ts |
| A | artifacts/api-server/src/lib/contractSmtpReceipt.ts |
| M | artifacts/api-server/src/lib/contractTemplateBranding.ts |
| A | artifacts/api-server/src/lib/documentByteLimits.ts |
| M | artifacts/api-server/src/lib/email.ts |
| M | artifacts/api-server/src/lib/safeOutboundRequest.ts |
| M | artifacts/api-server/src/lib/signContract.ts |
| M | artifacts/api-server/src/lib/signedContractDelivery.ts |
| A | artifacts/api-server/src/lib/signedContractDeliveryPolicy.ts |
| A | artifacts/api-server/src/lib/signedContractPdfRecovery.ts |
| M | artifacts/api-server/src/routes/agentApplications.ts |
| M | artifacts/api-server/src/routes/agentOnboarding.ts |
| M | artifacts/api-server/src/routes/agents.ts |
| M | artifacts/api-server/src/routes/contracts.ts |
| M | artifacts/api-server/src/routes/publicSigning.ts |
| A | artifacts/edcons/scripts/test-agent-contract-status-browser.mjs |
| A | artifacts/edcons/scripts/test-contract-editor-mode.ts |
| A | artifacts/edcons/src/components/contracts/ContractEmailStatus.tsx |
| M | artifacts/edcons/src/components/contracts/ContractRichTextEditor.tsx |
| A | artifacts/edcons/src/components/contracts/contractEditorMode.ts |
| M | artifacts/edcons/src/lib/i18n/translations/ar.json |
| M | artifacts/edcons/src/lib/i18n/translations/en.json |
| M | artifacts/edcons/src/lib/i18n/translations/es.json |
| M | artifacts/edcons/src/lib/i18n/translations/fa.json |
| M | artifacts/edcons/src/lib/i18n/translations/fr.json |
| M | artifacts/edcons/src/lib/i18n/translations/hi.json |
| M | artifacts/edcons/src/lib/i18n/translations/id.json |
| M | artifacts/edcons/src/lib/i18n/translations/ru.json |
| M | artifacts/edcons/src/lib/i18n/translations/tr.json |
| M | artifacts/edcons/src/lib/i18n/translations/zh.json |
| M | artifacts/edcons/src/pages/admin/Contracts.tsx |
| M | artifacts/edcons/src/pages/agent/Account.tsx |
| M | artifacts/edcons/src/pages/agent/Dashboard.tsx |
| A | artifacts/edcons/src/pages/agent/agentContractCopy.ts |
| M | artifacts/edcons/src/pages/sign/SignFlow.tsx |
| A | deploy/prepared-migrations/apply/0067_signed_contract_delivery.sql |
| A | deploy/prepared-releases/Dockerfile.apply-contract-builder |
| A | deploy/prepared-releases/Dockerfile.apply-contract-runtime |
| A | deploy/prepared-releases/assemble-apply-contract-candidate.mjs |
| A | deploy/prepared-releases/test-assemble-apply-contract-candidate.mjs |
| A | docs/APPLY_CONTRACT_CANDIDATE_RECIPE.md |
| A | docs/APPLY_CONTRACT_DURABLE_MAIL_PREPARATION_2026-11-25.md |
| A | docs/APPLY_CONTRACT_INDEPENDENT_REVIEW_2026-11-25.md |
| A | docs/CONTRACT47_CONTROLLED_RECOVERY.md |
