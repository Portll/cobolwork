SARSET   CSECT
         STM   14,12,12(13)
         LR    12,15
         USING SARSET,12
         L     2,0(,1)
         SAR   2,2
         LM    14,12,12(13)
         SR    15,15
         BR    14
         END
