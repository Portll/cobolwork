* SPDX-License-Identifier: AGPL-3.0-or-later
XCTLBYLIST CSECT
           STM   14,12,12(13)
           LR    12,15
           USING XCTLBYLIST,12
           LA    1,LIST
           L     2,0(,1)
           XCTL  DE=(2)
           LM    14,12,12(13)
           SR    15,15
           BR    14
LIST      DS    1A
           END
