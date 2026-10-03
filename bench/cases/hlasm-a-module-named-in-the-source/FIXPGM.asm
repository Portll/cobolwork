FIXPGM   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING FIXPGM,12
         LINK  EP=SUBPGM
         LM    14,12,12(13)
         SR    15,15
         BR    14
         END
