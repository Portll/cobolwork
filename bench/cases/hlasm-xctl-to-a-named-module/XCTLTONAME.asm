* SPDX-License-Identifier: AGPL-3.0-or-later
XCTLTONAME CSECT
           STM   14,12,12(13)
           LR    12,15
           USING XCTLTONAME,12
           XCTL  EP=TARGET
           LM    14,12,12(13)
           SR    15,15
           BR    14
           END
