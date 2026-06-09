// PM2 ecosystem config — EduConsult OS
// Bu dosya deploy/ecosystem.config.cjs'e referans verir (yetkili kaynak).
// Doğrudan deploy/ altındaki dosyayı kullanmak tercih edilir:
//
//   pm2 start deploy/ecosystem.config.cjs --env production
//   pm2 reload deploy/ecosystem.config.cjs --update-env
//   pm2 save
//
// Root'tan çalıştırmak için:
//   pm2 start ecosystem.config.cjs --env production

"use strict";

module.exports = require("./deploy/ecosystem.config.cjs");
