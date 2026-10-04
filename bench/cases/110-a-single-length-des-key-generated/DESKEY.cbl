       IDENTIFICATION DIVISION.
       PROGRAM-ID. DESKEY.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  RC          PIC 9(8) COMP.
       01  RS          PIC 9(8) COMP.
       01  EXL         PIC 9(8) COMP VALUE 0.
       01  EXD         PIC X(4).
       01  KEY-FORM    PIC X(8) VALUE 'OP'.
       01  KEY-LENGTH  PIC X(8) VALUE 'SINGLE'.
       01  KEY-TYPE-1  PIC X(8) VALUE 'DATA'.
       01  KEY-TYPE-2  PIC X(8) VALUE SPACES.
       01  KEK1        PIC X(64).
       01  KEK2        PIC X(64).
       01  KEY-ID      PIC X(64).
       01  KEY-ID2     PIC X(64).
       PROCEDURE DIVISION.
           CALL 'CSNBKGN' USING RC RS EXL EXD KEY-FORM KEY-LENGTH
               KEY-TYPE-1 KEY-TYPE-2 KEK1 KEK2 KEY-ID KEY-ID2.
           GOBACK.
