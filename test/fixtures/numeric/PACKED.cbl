       CBL NUMPROC(PFD)
       IDENTIFICATION DIVISION.
       PROGRAM-ID. PACKED.
      * The input record is laid over a packed field, and the program is
      * compiled with NUMPROC(PFD), which repairs no sign.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-AMOUNT        PIC S9(7)V99 COMP-3.
       01 WS-RATE             PIC S9(3)V99 COMP-3 VALUE 1.05.
       01 WS-DUE              PIC S9(9)V99 COMP-3.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           MULTIPLY WS-AMOUNT BY WS-RATE GIVING WS-DUE
           EXEC CICS RETURN END-EXEC.
